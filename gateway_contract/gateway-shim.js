const shim = require('fabric-shim')
const FledgeCrypto = require('./encryption').FledgeCrypto
const { readModelFromFile, encryptModel, analyzeModel, getDigest, uploadEncryptedData, downloadEncryptedData } = require('./utils')

// Blockchain Two Contract Computation (BT2C)
async function bt2c(stub, endpoint, args=null) {
    let data = [endpoint]
    if (args !== null) data = data.concat(args)
    let res = await stub.invokeChaincode('defender_contract1', data)
    let payload = res.payload.buffer.toString('utf8')
    payload = JSON.parse(payload.slice(payload.indexOf('{'), payload.lastIndexOf('}') + 1))
    return payload
}

async function getContext(stub) {
    // TT1 - { owner, ctx, rounds, reward }
    const buffer = await stub.getState('TT1')
    const string = buffer.toString('utf8')
    if (string === '') return {}
    return JSON.parse(string).pop().ctx
}

async function getSessions(stub) {
    // TT1 - { owner, ctx, rounds, reward }
    const buffer = await stub.getState('TT1')
    const string = buffer.toString('utf8')
    if (string === '') return {}
    return JSON.parse(string)
}

async function privateCosineDistance(stub, ctx, local, global, delta, models) {
    if (global.length !== local.length) throw Error(`Incompatible models: Global - ${global.length}, Local - ${local.length}`)
    const fledgeCrypto = await new FledgeCrypto().setup({scheme: ctx.scheme, security: ctx.security, 
                                                        degree: ctx.degree, bitSizes: ctx.bitSizes},
                                                        {pk: ctx.keys.pk, sk: '', gk: ctx.keys.gk, rk: ctx.keys.rk})
    const globalNorms = []
    const localNorms = []
    const dotProducts = []
    for (let i=0; i<global.length; i++) {
        const globalCipher = fledgeCrypto.addition(global[i], delta)
        const localCipher = local[i]
        globalNorms.push(fledgeCrypto.norm(globalCipher))
        localNorms.push(fledgeCrypto.norm(localCipher))
        dotProducts.push(fledgeCrypto.dotProduct(localCipher, globalCipher))
    }
    fledgeCrypto.destroy()
    let result = await bt2c(stub, 'secureDecryption', [JSON.stringify({ ciphers: globalNorms.join('\n'), models }), JSON.stringify(ctx)])
    const globalNormSum = Math.sqrt(result.plains.reduce((a,b) => a+b))
    result = await bt2c(stub, 'secureDecryption', [JSON.stringify({ ciphers: localNorms.join('\n'), models }), JSON.stringify(ctx)])
    const localNormSum = Math.sqrt(result.plains.reduce((a,b) => a+b))
    result = await bt2c(stub, 'secureDecryption', [JSON.stringify({ ciphers: dotProducts.join('\n'), models }), JSON.stringify(ctx)])
    const dotSum = result.plains.reduce((a,b) => a+b)
    return 1 - (dotSum / (globalNormSum * localNormSum))
}

async function globalModelStorage(stub, global, maxNumberOfCiphersPerTx) {
    let counter = 1
    while (global.length !== 0) {
        let chunk = []
        if (global.length < maxNumberOfCiphersPerTx) chunk = global.splice(0)
        else chunk = global.splice(0, maxNumberOfCiphersPerTx)
        let key = `TT7_${counter}`
        let data = { data: chunk.join('\n') }
        await uploadEncryptedData(stub, key, data)
        counter++
    }
}

async function getEncryptedModel(stub, seriesLength, id=null) {
    const chunks = []
    for (let i=1; i<=seriesLength; i++) {
        let key = ''
        if (id !== null) key = `TT2_${id}_${i}` // local model
        else key = `TT7_${i}` // global model
        let data = await downloadEncryptedData(stub, key)
        chunks.push(data)
    }
    return chunks.join('\n')
}

function getClientId(stub) {
    const creator = stub.getCreator().id_bytes.buffer.toString('utf-8')
    const idx1 = creator.indexOf('-----BEGIN CERTIFICATE-----') + '-----BEGIN CERTIFICATE-----'.length + 1
    const idx2 = creator.indexOf('-----END CERTIFICATE-----') - 1
    return getDigest(creator.slice(idx1, idx2))
}

async function getLocalModels(stub) {
    // TT2 - { cid, id, delta, series }
    const buffer = await stub.getState('TT2');
    const models = JSON.parse(buffer.toString('utf8'))
    return models
}

async function getModelStructure(stub) {
    // TT7 - { id, plain, structure }
    const buffer = await stub.getState('TT7')
    const string = buffer.toString('utf8')
    if (string === '') return []
    const structure = JSON.parse(string).structure
    return structure
}

async function getScores(stub) {
    // TT3 - { id, score }
    const buffer = await stub.getState('TT3')
    const string = buffer.toString('utf8')
    if (string === '') return {}
    return JSON.parse(string)
}

var Chaincode = class {

    async Init(stub) {
        return shim.success()
    }
    // DO NOT MODIFY
    async Invoke(stub) {
        try {
            let ret = stub.getFunctionAndParameters()
            let method = this[ret.fcn]
            if (method === undefined) throw Error('Method does not exists')
            let payload = await method(stub, ret.params)
            return shim.success(payload)
        } catch (err) {
            return shim.error(err)
        }
    }

    async initContract(stub, args) {
        // Inputs: arg0 - { owner, rounds, reward }
        const owner = JSON.parse(args[0]).owner
        const numberOfTrainingRounds = JSON.parse(args[0]).rounds
        const totalReward = JSON.parse(args[0]).reward
        const encryptionContext = await bt2c(stub, 'initEncryptionContext')
        // Init Transactions (TT1) - { owner, ctx, rounds, reward }
        const tt1 = { owner: getDigest(owner), ctx: encryptionContext, rounds: `${numberOfTrainingRounds}/${numberOfTrainingRounds}`, reward: totalReward }
        await stub.putState('TT1', Buffer.from(JSON.stringify([tt1])))
        // Inputs: arg1 - { name, type, limit }
        const modelName = JSON.parse(args[1]).name
        const modelType = JSON.parse(args[1]).type
        // Needed to mitigate memory issues
        const maxNumberOfCiphersPerTx = JSON.parse(args[1]).limit
        // Deploy first global model
        const model = readModelFromFile(modelName)
        const { flattenedModel, structure } = analyzeModel(model, modelType)
        const { modelPlains, modelCiphers } = await encryptModel(encryptionContext, flattenedModel)
        await globalModelStorage(stub, modelCiphers, maxNumberOfCiphersPerTx)
        const modelId = getDigest(JSON.stringify(modelPlains))
        // Global model (TT7) - { id, plain, structure }
        const tt7 = { id: modelId, plain: modelPlains, structure }
        await stub.putState('TT7', Buffer.from(JSON.stringify(tt7)))
        // Storage transactions (TT2) - { cid, id, delta, series }
        const ttx = []
        await stub.putState('TT2', Buffer.from(JSON.stringify(ttx)))
        // Analysis transactions (TT3) - { id, socre }
        await stub.putState('TT3', Buffer.from(JSON.stringify(ttx)))
        return Buffer.from(JSON.stringify({}))
    }

    async getGlobalModel(stub) {
        // TT7 - { id, plain, structure }
        const buffer = await stub.getState('TT7')
        const string = buffer.toString('utf8')
        if (string === '') return Buffer.from(JSON.stringify({}))
        const globalModel = JSON.parse(string).plain
        const structure = JSON.parse(string).structure
        // Output: { model, structure }
        return Buffer.from(JSON.stringify({ model: globalModel, structure }))
    }

    async getEncryptionContext(stub) {
        const encryptionContext = await getContext(stub)
        // Output: { scheme, security, degree, bitSizes, keys }, 
        // where keys = { pk, gk, rk }
        return Buffer.from(JSON.stringify(encryptionContext))
    }

    async getTrainingSessions(stub) {
        const sessions = await getSessions(stub)
        // Output: { sessions }
        return Buffer.from(JSON.stringify({ sessions }))
    }

    async localModelStorage(stub, args) {
        // Input: { id, ciphers, series }
        const modelId = JSON.parse(args[0]).id
        const ciphers = JSON.parse(args[0]).ciphers
        const series = JSON.parse(args[0]).series
        const key = `TT2_${modelId}_${series.split('/')[0]}`
        const data = { data: ciphers }
        await uploadEncryptedData(stub, key, data)
        // Output: { id, completed }
        return Buffer.from(JSON.stringify({ id: modelId, completed: series }))
    }

    async commitLocalModel(stub, args) {
        // Input: { id, delta, length }
        const modelId = JSON.parse(args[0]).id
        const delta = JSON.parse(args[0]).delta
        const seriesLength = JSON.parse(args[0]).length
        const clientId = getClientId(stub)
        const encryptedLocalModel = await getEncryptedModel(stub, seriesLength, modelId)
        const encryptedGlobalModel = await getEncryptedModel(stub, seriesLength)
        const encryptedLocalModels = await getLocalModels(stub)
        const encryptionContext = await getContext(stub)
        const scores = await getScores(stub)
        let score = 0
        if (encryptedLocalModels.map(e => e.id).indexOf(modelId) === -1) {
            score = await privateCosineDistance(stub, encryptionContext, encryptedLocalModel.split('\n'), 
                                                encryptedGlobalModel.split('\n'), delta, encryptedLocalModels)
            // TT2 - { cid, id, delta, series }
            const tt2 = { cid: clientId, id: modelId, delta, series: seriesLength }
            encryptedLocalModels.push(tt2)
            await stub.putState('TT2', Buffer.from(JSON.stringify(encryptedLocalModels)))
            // TT3 - { id, score }
            const tt3 = { id: modelId, score }
            scores.push(tt3)
            await stub.putState('TT3', Buffer.from(JSON.stringify(scores)))
        }
        // Output: { score }
        return Buffer.from(JSON.stringify({ score }))
    }

    async getCommittedLocalModels(stub) {
        const encryptedLocalModels = await getLocalModels(stub)
        // Output: { models }
        // models: [TT2x] where x = [1..K] (K = number of clients)
        return Buffer.from(JSON.stringify({ models: encryptedLocalModels }))
    }

    async privateAggregation(stub, args) {
        const maxNumberOfCiphersPerTx = JSON.parse(args[0]).limit
        const localModelId = await getLocalModels(stub)
        const structure = await getModelStructure(stub)
        const results = await bt2c(stub, 'getBenignModels')
        const benignModelIds = results.ids
        const benignModels = []
        for (const m of localModelId) {
            if (benignModelIds.includes(m.id)) benignModels.push(m)
        }
        const initialModel = benignModels[0]
        let encryptedModelTemplate = await getEncryptedModel(stub, initialModel.series, initialModel.id)
        encryptedModelTemplate = encryptedModelTemplate.split('\n')
        const encryptionContext = await getContext(stub) 
        const sessions = await getSessions(stub)
        const session = sessions.slice(-1)[0]
        // Check if session has been completed
        if (parseInt(session.rounds.split('/')[0]) - 1 < 0) return Buffer.from(JSON.stringify({}))
        const fledgeCrypto = await new FledgeCrypto().setup({scheme: encryptionContext.scheme, security: encryptionContext.security, 
                                                            degree: encryptionContext.degree, bitSizes: encryptionContext.bitSizes},
                                                            {pk: encryptionContext.keys.pk, sk: '', gk: '', rk: ''})
        for (let i=1; i<benignModels.length; i++) {
            const model = benignModels[i]
            let encryptedLocalModel = await getEncryptedModel(stub, model.series, model.id)
            encryptedLocalModel = encryptedLocalModel.split('\n')
            let ciphers = []
            for (let j=0; j<encryptedModelTemplate.length; j++) {
                ciphers.push(fledgeCrypto.addition(encryptedModelTemplate[j], encryptedLocalModel[j]))
            }
            encryptedModelTemplate = ciphers.join('\n').split('\n')
        }
        fledgeCrypto.destroy()
        let result = await bt2c(stub, 'secureDecryption', [JSON.stringify({ ciphers: encryptedModelTemplate.join('\n'), models: benignModels }), 
                                        JSON.stringify(encryptionContext), JSON.stringify(sessions)])
        const newGlobalModel = result.plains
        const flattenedModel = newGlobalModel.flat()
        let numerator = parseInt(session.rounds.split('/')[0]) - 1
        let denominator = parseInt(session.rounds.split('/')[1])
        const tt1 = { owner: session.owner, ctx: session.ctx, rounds: `${numerator}/${denominator}`, reward: session.reward }
        sessions.push(tt1)
        await stub.putState('TT1', Buffer.from(JSON.stringify(sessions)))
        // Reset TT2 and TT3 
        const ttx = []
        await stub.putState('TT2', Buffer.from(JSON.stringify(ttx)))    
        await stub.putState('TT3', Buffer.from(JSON.stringify(ttx))) 
        if (flattenedModel.reduce((a,b) => a+b) === 0) return Buffer.from(JSON.stringify({}))
        const { modelPlains, modelCiphers } = await encryptModel(encryptionContext, flattenedModel)
        await globalModelStorage(stub, modelCiphers, maxNumberOfCiphersPerTx)
        const modelId = getDigest(JSON.stringify(modelPlains))
        // TT7 - { id, plain, structure }
        const tt7 = { id: modelId, plain: modelPlains, structure }
        await stub.putState('TT7', Buffer.from(JSON.stringify(tt7)))
        return Buffer.from(JSON.stringify({}))
    }
}
shim.start(new Chaincode());