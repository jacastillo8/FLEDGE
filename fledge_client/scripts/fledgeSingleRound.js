const path = require('path')
const fs = require('fs')
const { FledgeClient } = require('../middleware/client')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

/*********************************** 
 ** Blockchain Client Information ** 
 ***********************************/
let channel = process.env.CHANNEL_NAME.toLowerCase()

let org1 = process.env.ORG_NAME
let user1 = process.env.USER_NAME

let contract1 = 'gateway_contract1'
let contract2 = 'defender_contract1'

async function initSession(globalModelName, learningTask, owner, rounds, reward) {
    let clientA = new FledgeClient('', { org: org1, user: user1, channel: channel, contract: contract1})
    await clientA.connect()
    // Init Session
    await clientA.initContract(globalModelName, learningTask, owner, rounds, reward)
    await clientA.disconnect()
}

async function submitModelsFromFolder(model_folder, numberOfModels) {
    let models = fs.readdirSync(model_folder).slice(0, numberOfModels)
    for (let i=0; i<models.length; i++) {
        let clientA = new FledgeClient(model_folder, { org: org1, user: user1, channel: channel, contract: contract1}, false, i)
        try {
            // Connect to FLEDGE
            await clientA.connect()
            result = await clientA.getEncryptionContext()
            console.log(`[+] Client ${i} - Downloaded Encryption Context`)
            // Encrypt model
            let model = await clientA.encrypt()
            console.log(`[+] Client ${i} - Model Encryption Complete`)
            // Submit model to FLEDGE
            result = await clientA.insertModel(model)
            console.log(`[+] Client ${i} - Model Insertion Complete`)
            await clientA.disconnect()
        } catch (err) {
            await clientA.disconnect()
            console.log(`[+] Client ${i} - Disconnected from Fabric`)
            console.log(err)
        }
    }
}

async function computeModelAggregation() {
    let clientA = new FledgeClient('', { org: org1, user: user1, channel: channel, contract: contract2})
    // Connect to FLEDGE
    await clientA.connect()
    // Deploy defense (if any)
    result = await clientA.activateDefense()
    console.log('[+] Activating defense')
    await clientA.setContract(contract1)
    // Perform model aggregation in FLEDGE
    result = await clientA.requestAggregation()
    console.log(`[+] Computing aggregation: ${Object.keys(result)}`)
    // Downloading global model from FLEDGE
    result = await clientA.getGlobalModel()
    console.log('[+] Download Global Model')
    // Disconnect
    await clientA.disconnect()
    console.log('[+] Disconnected from Fabric')
}

async function main() {
    // Task selection
    const taskNumber = 0 // 0 for MNIST; 1 for CIFAR10
    const datasets = ['MNIST', 'CIFAR10']
    const globals = ['G5', 'G50'] // Part of the model name in file. Describes the current training round of the model
    const model_folder = `/home/jacastillo8/bcfl_client/models/${datasets[taskNumber]}`
    // Testing different number of models per round
    const numberOfModels = [8, 1, 5, 1, 3]
    const trainingSessions = [{ owner: 'test_owner', rounds:2, reward:50 },
                              { owner: 'test_owner', rounds:3, reward:100 }]
    for (const s of trainingSessions) {
        await initSession(`${datasets[taskNumber]}_${globals[taskNumber]}`, datasets[taskNumber], s.owner, s.rounds, s.reward)
        for (let i=0; i<s.rounds; i++) {
            await submitModelsFromFolder(model_folder, numberOfModels[i])
            await computeModelAggregation()
        }
    }    
}

main()