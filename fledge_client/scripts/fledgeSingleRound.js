const pino = require('pino')
const path = require('path')
const fs = require('fs')
const { FledgeClient } = require('../middleware/client')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

// Logger setup
const logger = pino(
    {
        level: 'info',
        transport: {
            target: 'pino-pretty'
      },
    },
    //pino.destination("./pino-logger.log")
)

/*********************************** 
 ** Blockchain Client Information ** 
 ***********************************/
let channel = process.env.CHANNEL_NAME.toLowerCase()

let org1 = process.env.ORG_NAME
let user1 = process.env.USER_NAME

let contract1 = 'gateway_contract1'
let contract2 = 'defender_contract1'

function randomIntFromInterval(min, max) { // min and max included 
    return Math.floor(Math.random() * (max - min + 1) + min)
}

async function initSession(globalModelName, learningTask, owner, rounds, reward) {
    logger.info('Initializing Session in Gateway')
    let clientA = new FledgeClient('', { org: org1, user: user1, channel: channel, contract: contract1}, learningTask)
    await clientA.connect()
    // Init Session
    await clientA.initContract(globalModelName, owner, rounds, reward)
    logger.info(`Gateway initialized for current session:\towner:${owner}\trounds:${rounds}\treward:${reward}`)
    await clientA.disconnect()
}

async function submitModelsFromFolder(model_folder, learningTask, numberOfModels) {
    let models = fs.readdirSync(model_folder).slice(0, numberOfModels)
    logger.info(`Initiating model submission to FLEDGE:\t#models:${models.length}`)
    for (let i=0; i<models.length; i++) {
        let clientA = new FledgeClient(model_folder, { org: org1, user: user1, channel: channel, contract: contract1}, learningTask, false, i)
        let result = {}
        try {
            // Connect to FLEDGE
            await clientA.connect()
            logger.info(`Client ${i} connected to FLEDGE`)
            result = await clientA.getEncryptionContext()
            logger.info(`Client ${i} downloaded encryption context:\tscheme:${result.scheme}\tdegree:${result.degree}`)
            // Encrypt model
            result = await clientA.encrypt()
            logger.info(`Client ${i} encrypted model:\tid:${result.id}\t#ciphers:${result.ciphers.split('\n').length}`)
            // Submit model to FLEDGE
            result = await clientA.insertModel(result)
            logger.info(`Client ${i} submitted model:\tscore:${result.score}`)
            await clientA.disconnect()
            logger.info(`Client ${i} disconnected from FLEDGE`)
        } catch (err) {
            await clientA.disconnect()
            logger.error(`Client ${i} disconnected from network due to exception:\terror:${err}`)
        }
    }
}

async function computeModelAggregation(model_folder, learningTask) {
    let clientA = new FledgeClient(model_folder, { org: org1, user: user1, channel: channel, contract: contract2}, learningTask)
    // Connect to FLEDGE
    await clientA.connect()
    // Deploy defense (if any). Note that defender contract is set to "No Defense"
    let result = await clientA.activateDefense()
    // Rc = Contract Reward, Rt = Training Reward
    logger.info(`Activated defender:\t#benign:${result.tt5.benign.length}\t#malicious:${result.tt5.malicious.length}\tRc:${result.tt4.rc}\tRt:${result.tt6.rt}`)
    await clientA.setContract(contract1)
    // Perform model aggregation in FLEDGE
    await clientA.requestAggregation()
    logger.info(`Requested aggregation:\t#models:${result.tt5.benign.length}`)
    // Downloading global model from FLEDGE
    result = await clientA.getGlobalModel()
    logger.info('Downloaded new global model from FLEDGE')
    // Disconnect
    await clientA.disconnect()
}

async function main() {
    // Task selection
    const taskNumber = 0 // 0 for MNIST; 1 for Fashion; 2 for CIFAR10
    const datasets = ['MNIST', 'Fashion', 'CIFAR10']
    const globals = ['G5', 'G5', 'G50'] // Part of the model name in file. Describes the current training round of the model
    const model_folder = `${path.join(__dirname, '..')}/models/${datasets[taskNumber]}/json_models`
    logger.info(`Fledge experiment configurations:\n\tLearning task: ${datasets[taskNumber]}\tDirectory: ${model_folder}`)
    const trainingSessions = [{ owner: 'test_owner', rounds:1, reward:50 },
                              { owner: 'test_owner', rounds:1, reward:100 }]
    for (const s of trainingSessions) {
        // Testing different number of models per round
        const numberOfModels = randomIntFromInterval(1, 20)
        await initSession(`${datasets[taskNumber]}_${globals[taskNumber]}`, datasets[taskNumber], s.owner, s.rounds, s.reward)
        for (let i=0; i<s.rounds; i++) {
            await submitModelsFromFolder(model_folder, datasets[taskNumber], numberOfModels)
            await computeModelAggregation(model_folder, datasets[taskNumber])
        }
    }    
}

main()