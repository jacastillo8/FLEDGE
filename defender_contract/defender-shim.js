const shim = require('fabric-shim');
const FledgeCrypto = require('./encryption').FledgeCrypto
const { generateContext, getSecretKey } = require('./utils')

async function findContractAnomalies(stub) {
    const buffer = await stub.getState('TT4')
    const string = buffer.toString('utf8')
    if (string === '') return 0 // phi = 0 if empty
    return JSON.parse(string).phi
}

// Blockchain Two Contract Computation (BT2C)
async function bt2c(stub, endpoint, args=null) {
    let data = [endpoint];
    if (args !== null) data = data.concat(args)
    let res = await stub.invokeChaincode('gateway_contract1', data)
    let payload = res.payload.buffer.toString('utf8')
    payload = JSON.parse(payload.slice(payload.indexOf('{'), payload.lastIndexOf('}') + 1))
    return payload
}

// This is a placeholder function used to include different defenses. 
// Our defense implementation can be found in "../fledge_client/scripts/gkdeDefense.py"
function filterPoison(models) {
    const scores = models.map(e => e.score)
    const ids = models.map(e => e.id)
    const selected = []
    for (let i=0; i<scores.length; i++) {
        // No Defense scenario. Selects all models
        selected.push(ids[i])
    }
    return selected
}

function calculateRewards(numberOfSessions, numberOfAnomalies, currentSession) {
    const tt1 = currentSession
    const totalReward = tt1.reward
    const numberOfRounds = parseInt(tt1.rounds.split('/')[1])
    if (numberOfRounds === 0) return { rt: 0, rc: 0 }
    const contractReward = totalReward * 0.1 * Math.exp(-(numberOfAnomalies)/numberOfSessions)
    const trainingReward = (totalReward - contractReward) / numberOfRounds
    return { rt: trainingReward, rc: contractReward }
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

    async initEncryptionContext(stub) {
        const encryptionContext = await generateContext()
        return Buffer.from(JSON.stringify(encryptionContext))
    }

    async getBenignModels(stub) {
        // TT5 - { benign, malicious }
        let buffer = await stub.getState('TT5')
        let string = buffer.toString('utf8');
        if (string === '') return Buffer.from(JSON.stringify({}))
        const benignModelIds = JSON.parse(string).benign
        // Output: { ids }
        return Buffer.from(JSON.stringify({ ids: benignModelIds }))
    }

    async secureDecryption(stub, args) {
        const ciphers = JSON.parse(args[0]).ciphers.split('\n')
        const localModels = JSON.parse(args[0]).models
        const encryptionContext = JSON.parse(args[1])
        const sk = getSecretKey()
        const tol = 0.05
        const K = localModels.length
        const fledgeCrypto = await new FledgeCrypto().setup({scheme: encryptionContext.scheme, security: encryptionContext.security, 
                                                            degree: encryptionContext.degree, bitSizes: encryptionContext.bitSizes},
                                                            {pk: '', sk: sk, gk: '', rk: ''})
        const plains = []
        for (const c of ciphers) {
            let p = Array.from(fledgeCrypto.decode(fledgeCrypto.decrypt(c)))
            const v = Math.abs((Math.max(...p) - Math.min(...p))/Math.max(...p))
            if (v <= tol) p = p.reduce((a,b) => a+b) / p.length
            else if (K > 1) {
                let deltas = localModels.map(e => e.delta)
                let deltaSum = Array.from(fledgeCrypto.decode(fledgeCrypto.decrypt(deltas[0])))
                for (let d=1; d<deltas.length; d++) {
                    let delta = Array.from(fledgeCrypto.decode(fledgeCrypto.decrypt(deltas[d])))
                    deltaSum = deltaSum.map((e,i) => e + delta[i])
                }
                p = p.map((e,i) => (e - deltaSum[i]) / K)
            } else {
                const sessions = JSON.parse(args[2])
                const lastSession = sessions.slice(-1)[0]
                const anomalies = await findContractAnomalies(stub)
                const { rt, rc } = calculateRewards(sessions.length, anomalies + 1, lastSession)
                const tt4 = { rc, phi: anomalies + 1 }
                await stub.putState('TT4', Buffer.from(JSON.stringify(tt4)))
                p = Array(Math.floor(encryptionContext.degree / 2)).fill(0) 
            }
            plains.push(p)
        }
        fledgeCrypto.destroy()
        return Buffer.from(JSON.stringify({ plains }))
    }

    async applyPoisonDefense(stub) {
        const results = await bt2c(stub, 'getCommittedLocalModels')
        const selectedModels = filterPoison(results.models)
        // TT5 - { benign, malicious }
        const tt5 = { benign: selectedModels, malicious: [] }
        await stub.putState('TT5', Buffer.from(JSON.stringify(tt5)))
        const anomalies = await findContractAnomalies(stub)
        const trainingSessions = await bt2c(stub, 'getTrainingSessions')
        const lastSession = trainingSessions.sessions.slice(-1)[0]
        let { rt, rc } = calculateRewards(trainingSessions.sessions.length, anomalies, lastSession)
        rt = rt / selectedModels.length
        // TT6 - { rt }
        const tt6 = { rt }
        await stub.putState('TT6', Buffer.from(JSON.stringify(tt6)))
        // TT4 - { rc, phi }
        const tt4 = { rc, phi: anomalies }
        await stub.putState('TT4', Buffer.from(JSON.stringify(tt4)))
        return Buffer.from(JSON.stringify({ tt4, tt5, tt6 }))
    }
}
shim.start(new Chaincode());