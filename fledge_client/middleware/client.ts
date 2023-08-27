'use strict'
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

let { Wallets, Contract, Gateway, DefaultEventHandlerStrategies, 
    DefaultQueryHandlerStrategies } = require('fabric-network')

// Used to select relevant layers of model
const MNIST_MODEL_LAYERS = ['layer1.0.weight', 'layer1.0.bias', 'fc.weight', 'fc.bias']

const CIFAR10_MODEL_LAYERS = ['conv1.weight', 'conv1.bias', 'layer1.0.fn.0.weight', 'layer1.0.fn.0.bias', 'layer1.0.fn.2.weight', 'layer1.0.fn.2.bias', 
                            'layer1.1.weight', 'layer1.1.bias', 'layer1.3.weight', 'layer1.3.bias', 'layer2.0.fn.0.weight', 'layer2.0.fn.0.bias', 
                            'layer2.0.fn.2.weight', 'layer2.0.fn.2.bias', 'layer2.1.weight', 'layer2.1.bias', 'layer2.3.weight', 'layer2.3.bias',
                            'layer3.0.fn.0.weight', 'layer3.0.fn.0.bias', 'layer3.0.fn.2.weight', 'layer3.0.fn.2.bias', 'layer3.1.weight', 'layer3.1.bias', 
                            'layer3.3.weight', 'layer3.3.bias', 'fc.weight', 'fc.bias']

const Fashion_MODEL_LAYERS = ['layer1.0.weight', 'layer1.0.bias', 'layer1.1.weight', 'layer1.1.bias', 'layer2.0.weight', 'layer2.0.bias', 'layer2.1.weight', 
                              'layer2.1.bias', 'fc.weight', 'fc.bias']

const modelTypes = { MNIST: MNIST_MODEL_LAYERS, Fashion: Fashion_MODEL_LAYERS, CIFAR10: CIFAR10_MODEL_LAYERS }

// Interfaces
import { Client } from '../interfaces/client'
import { FledgeCrypto } from '../middleware/encryption'

let queue: any[] = []
function getStructure(root: any[]) {
    if (root.length === undefined) return
    queue.push(root.length)
    getStructure(root[0])
}

function getDigest(string: string) {
    let md5sum = crypto.createHash('md5')
    md5sum.update(string)
    return md5sum.digest('hex')
}

function std(array: number[]) {
    const n = array.length
    const mean = array.reduce((a, b) => a + b) / n
    return Math.sqrt(array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n)
}

function getNonZeroRandom(min: number, max:number) {
    let random = Math.random() * (max - min) + min
    while (random === 0) random = Math.random() * (max - min) + min
    return random
}

function randomIntFromInterval(min:number, max:number) { // min and max included 
    return Math.floor(Math.random() * (max - min + 1) + min)
}

function generateDelta(array: number[]) {
    return std(array)*getNonZeroRandom(-100, 100)
}

function analyzeModel(layers: any[], weights: any) {   
    let flattenedArrays: any = []
    let arrayStruct: any = []
    for (const l of layers) {
        for (const t of [weights[l]]) {
            getStructure(t)
            let arr = t.flat(queue.length)
            flattenedArrays.push(arr);
            arrayStruct.push(queue.join(','))
            queue = []
        }
    }
    return { data: flattenedArrays.flat(), format: arrayStruct }
}

function reassembleLayer(layer: any[], structure: any[]) {
    let tmp: any = []
    for (let j=0; j<structure.length; j++) {
        let layerStructure = parseInt(structure[j])
        while (layer.length !== 0) {
            tmp.push(layer.splice(0, layerStructure))
        }
        layer = tmp
        tmp = []
    }
    return layer[0]
}

function reassembleModel(flattenedModel: any, targetStructure:any, modelTemplate:any) {
    const model:any = {}
    for (let i=0; i<targetStructure.length; i++) {
        let layerName = modelTemplate[i]
        let layerStructure = targetStructure[i].split(',').reverse()
        let arrayLength = layerStructure.reduce((a:any,b:any) => a*b)
        let rawLayer = flattenedModel.splice(0, arrayLength)
        model[layerName] = reassembleLayer(rawLayer, layerStructure)
    }
    return model
}

export class FledgeClient {
    private contract: typeof Contract
    private gateway: typeof Gateway
    private crypto: FledgeCrypto = new FledgeCrypto()
    private degree: number = 0

    constructor(private experimentLocation: string, private client: Client, public learningTask: string,
                public malicious: boolean=false, public id: number=0, public maxNumberOfCiphersPerTx: number=60) {
    }

    // ########################## Generic Functions ##########################
    // Functions used to setup network and prepare models
    async connect(local :boolean =true) {
        const ccpPath = path.join(__dirname, '..', 'ccp', `connection-${this.client.org}.json`)
        const ccpJSON = fs.readFileSync(ccpPath, 'utf8')
        const ccp = JSON.parse(ccpJSON)
    
        const walletPath = path.join(__dirname, '..', 'wallet')
        const wallet =  await Wallets.newFileSystemWallet(walletPath)
    
        this.gateway = new Gateway()
        await this.gateway.connect(ccp, { wallet, identity: this.client.user, discovery: { enabled: true, asLocalhost: local },
                eventHandlerOptions: { endorseTimeout: 300, commitTimeout: 300, strategy: DefaultEventHandlerStrategies.MSPID_SCOPE_ALLFORTX },
                queryHandlerOptions: { timeout: 150, strategy: DefaultQueryHandlerStrategies.MSPID_SCOPE_SINGLE }})
        const network = await this.gateway.getNetwork(this.client.channel)
        this.contract = await network.getContract(this.client.contract)
    }

    async disconnect() {
        this.crypto.destroy()
        await this.gateway.disconnect()
    }

    async setContract(name:string='') {
        const network = await this.gateway.getNetwork(this.client.channel)
        this.contract = await network.getContract(name)
    }

    encrypt(array: any = null) {
        let flattenArray: any
        if (array === null) flattenArray = this.inspectModel().data
        else flattenArray = array.flat()
        const delimiter = '\n'
        const delta = generateDelta(flattenArray)
        const noisyArray = flattenArray.map((e:any) => e + delta)
        const deltaArray = Float64Array.from({length: this.degree / 2}, () => delta)
        let counter = 0
        let text = ''
        while (noisyArray.length !== 0) {
            let arr = Float64Array.from(noisyArray.splice(0, Math.floor(this.degree / 2)))
            let plainText = this.crypto.encode(arr)
            let cipherText = this.crypto.encrypt(plainText)
            text = text + `${cipherText}${delimiter}`
            counter++
        }
        let data = text.split('\n').filter((e: any) => e !== '')
        return { id: getDigest(text), ciphers: data.join('\n'), 
                delta: this.crypto.encrypt(this.crypto.encode(deltaArray)), count: counter }
    }

    inspectModel() {
        const modelName = this.malicious ? `M${randomIntFromInterval(0,14)}`:`B${randomIntFromInterval(0,29)}`
        const model = JSON.parse(fs.readFileSync(`${this.experimentLocation}/${modelName}.json`))
        const layers = this.validateLayers(Object.keys(model))
        const abstractModel = analyzeModel(layers, model)
        return abstractModel
    }

    validateLayers(layers: any) {
        let data = this.learningTask
        const modelType = modelTypes[data as keyof typeof modelTypes]
        const valid: any = []
        for (let l of layers) {
            if (modelType.includes(l)) valid.push(l)
        }
        return valid
    }

    // ########################## Gateway Functions ##########################
    // Functions used to interface with gateway smart contract
    async initContract(name:string='', owner:string='0000', rounds:number=5, reward:number=10) {
        let arg0 = { owner, rounds, reward }
        let arg1 = { name, type: this.learningTask, limit: this.maxNumberOfCiphersPerTx }
        let res = await this.contract.submitTransaction('initContract', JSON.stringify(arg0), JSON.stringify(arg1))
        return JSON.parse(res.toString('utf-8'))
    }

    async getEncryptionContext() {
        const contextObject = await this.contract.evaluateTransaction('getEncryptionContext')
        const encryptionContext = JSON.parse(contextObject.toString('utf-8'))
        this.degree = encryptionContext.degree
        this.crypto = await this.crypto.setup({ scheme: encryptionContext.scheme, security: encryptionContext.security, 
                                                degree: encryptionContext.degree, bitSizes: encryptionContext.bitSizes },
                                                { pk: encryptionContext.keys.pk, sk: '', gk: '', rk: ''})
        return encryptionContext
    }

    async getGlobalModel() {
        const modelObject = await this.contract.evaluateTransaction('getGlobalModel')
        let model = JSON.parse(modelObject.toString('utf-8')).model
        const structure = JSON.parse(modelObject.toString('utf-8')).structure
        const flattenedModel = model.flat()
        const data = this.learningTask
        const modelTemplate = modelTypes[data as keyof typeof modelTypes]
        model = reassembleModel(flattenedModel, structure, modelTemplate)
        return model
    }

    async getLocalModels() {
        const locals = await this.contract.evaluateTransaction('getCommittedLocalModels')
        const models = JSON.parse(locals.toString('utf-8')).models
        return models
    }

    async insertModel(model: any) {
        const id = model.id
        const ciphers = model.ciphers.split('\n')
        let counter = 1
        const numberOfTx = Math.ceil(model.count / this.maxNumberOfCiphersPerTx)
        while (ciphers.length !== 0) {
            const chunk = ciphers.splice(0, this.maxNumberOfCiphersPerTx).join('\n')
            await this.contract.submitTransaction('localModelStorage', JSON.stringify({ id, ciphers: chunk, series: `${counter}/${numberOfTx}` }))
            counter++;
        }
        let buffer = await this.contract.submitTransaction('commitLocalModel', JSON.stringify({ id, delta: model.delta, length: `${numberOfTx}` }))
        let score = JSON.parse(buffer.toString('utf-8'))
        return { score: score.score, count: numberOfTx }
    }

    async requestAggregation() {
        let res = await this.contract.submitTransaction('privateAggregation', JSON.stringify({ limit: this.maxNumberOfCiphersPerTx }));
        return JSON.parse(res.toString('utf8'));
    }    
    
    // ########################## Defender Functions ##########################
    // Functions used to interface with defender smart contract 
    async activateDefense() {
        let res = await this.contract.submitTransaction('applyPoisonDefense');
        return JSON.parse(res.toString('utf8'));
    }
}
