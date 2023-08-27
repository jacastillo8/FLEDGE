const crypto = require('crypto')
const fs = require('fs')
const FledgeCrypto = require('./encryption').FledgeCrypto

// Used to select relevant layers of model
const MNIST_MODEL_LAYERS = ['layer1.0.weight', 'layer1.0.bias', 'fc.weight', 'fc.bias']

const CIFAR10_MODEL_LAYERS = ['conv1.weight', 'conv1.bias', 'layer1.0.fn.0.weight', 'layer1.0.fn.0.bias', 'layer1.0.fn.2.weight', 'layer1.0.fn.2.bias', 
                                'layer1.1.weight', 'layer1.1.bias', 'layer1.3.weight', 'layer1.3.bias', 'layer2.0.fn.0.weight', 'layer2.0.fn.0.bias', 
                                'layer2.0.fn.2.weight', 'layer2.0.fn.2.bias', 'layer2.1.weight', 'layer2.1.bias', 'layer2.3.weight', 'layer2.3.bias',
                                'layer3.0.fn.0.weight', 'layer3.0.fn.0.bias', 'layer3.0.fn.2.weight', 'layer3.0.fn.2.bias', 'layer3.1.weight', 'layer3.1.bias', 
                                'layer3.3.weight', 'layer3.3.bias', 'fc.weight', 'fc.bias']
                        
const Fashion_MODEL_LAYERS = ['layer1.0.weight', 'layer1.0.bias', 'layer1.1.weight', 'layer1.1.bias', 'layer2.0.weight', 'layer2.0.bias', 'layer2.1.weight', 
                                'layer2.1.bias', 'fc.weight', 'fc.bias']

const modelTemplates = { MNIST: MNIST_MODEL_LAYERS, Fashion: Fashion_MODEL_LAYERS, CIFAR10: CIFAR10_MODEL_LAYERS }

let queue = [];
function getModelStructure(root) {
    if (root.length === undefined) return
    queue.push(root.length)
    getModelStructure(root[0])
}

function getDigest(string) {
    let md5sum = crypto.createHash('md5');
    md5sum.update(string);
    return md5sum.digest('hex');
}

function validateLayers(modelLayers, modelType) {
    const modelTemplate = modelTemplates[modelType]
    const validLayer = []
    for (let layer of modelLayers) {
        if (modelTemplate.includes(layer)) validLayer.push(layer)
    }
    return validLayer
}

function analyzeModel(model, modelType) {   
    const modelLayers = Object.keys(model)
    const validModelLayers = validateLayers(modelLayers, modelType)
    const flattenedLayers = [];
    const modelStructure = [];
    for (const layer of validModelLayers) {
        for (const t of [model[layer]]) {
            getModelStructure(t);
            const arr = t.flat(queue.length);
            flattenedLayers.push(arr);
            modelStructure.push(queue.join(','));
            queue = [];
        }
    }
    return { flattenedModel: flattenedLayers.flat(), structure: modelStructure };
}

async function encryptModel(encryptionContext, flattenedModel) {
    const fledgeCrypto = await new FledgeCrypto().setup({scheme: encryptionContext.scheme, security: encryptionContext.security, 
                                                        degree: encryptionContext.degree, bitSizes: encryptionContext.bitSizes},
                                                        {pk: encryptionContext.keys.pk, sk: '', gk: '', rk: ''})
    const maxArrayLength = Math.floor((encryptionContext.degree / 2));
    let modelPlains = [];
    const modelCiphers = []
    while (flattenedModel.length !== 0) {
        let plainChunk = []
        if (flattenedModel.length < maxArrayLength) plainChunk = Float64Array.from(flattenedModel.splice(0))            
        else plainChunk = Float64Array.from(flattenedModel.splice(0, maxArrayLength))
        modelPlains.push(plainChunk);
        modelCiphers.push(fledgeCrypto.encrypt(fledgeCrypto.encode(plainChunk)))
    }
    fledgeCrypto.destroy()
    // Transform modelPlains from objects to actual arrays
    const tmp = []
    for (const p of modelPlains) {
        let array = Array.from(Object.values(p))
        tmp.push(array)
    }
    modelPlains = tmp
    return { modelPlains: modelPlains, modelCiphers: modelCiphers }
}

function readModelFromFile(modelName) {
    return JSON.parse(fs.readFileSync(`./models/${modelName}.json`))
}

async function uploadEncryptedData(stub, key, data) {
    await stub.putState(key, Buffer.from(JSON.stringify(data)))
}

async function downloadEncryptedData(stub, key) {
    let buffer = await stub.getState(`${key}`)
    return JSON.parse(buffer.toString('utf-8')).data
}

module.exports = {
    getDigest,
    analyzeModel,
    encryptModel,
    readModelFromFile,
    uploadEncryptedData,
    downloadEncryptedData
}