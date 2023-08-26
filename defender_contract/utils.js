const FledgeCrypto = require('./encryption').FledgeCrypto
const fs = require('fs');

// Modify functions uploadKey and downloadKey to manage private key sk
// For instance, send it to external database
function uploadKey(sk) {
    fs.writeFileSync(`./secret.key`, sk)
}

function downloadKey() {
    return fs.readFileSync('./secret.key').toString('utf-8')
}

async function generateContext() {
    const fledgeCrypto = await new FledgeCrypto().setup({scheme: 'CKKS', security: 'TC128', degree: 4096, bitSizes: [60,45]})
    const keys = fledgeCrypto.getKeys()
    const pk = keys.pk;
    const sk = keys.sk;
    const gk = keys.gk;
    const rk = keys.rk;
    fledgeCrypto.destroy()
    // degree: 2048, bitSizes: [54]; degree: 4096, bitSizes: [60, 45]
    let ctx = { scheme: 'CKKS', security: 'TC128', degree: 4096, bitSizes: [60, 45], keys: { pk, gk, rk } }
    uploadKey(sk)
    return ctx
}

function getSecretKey() {
    const key = downloadKey()
    return key
}

module.exports = {
    generateContext,
    getSecretKey
}