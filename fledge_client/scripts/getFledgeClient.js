require('dotenv').config();
const fs = require('fs');
const axios = require('axios');

const host = 'localhost';
const port = process.env.PORT;
const bid = process.env.BID;

let org1 = process.env.ORG_NAME;
let user1 = process.env.USER_NAME;

let orgs = [{ org: org1, user: user1 }]

async function downloadClient(org, user) {
    try {
        let ccp = await axios.get(`http://${host}:${port}/api/${bid}/config/${org}`)
        let wallet = await axios.get(`http://${host}:${port}/api/${bid}/wallet/${user}/${org}`)
        
        wallet = wallet.data
        ccp = ccp.data
        for (let i=0; i<Object.keys(ccp.peers).length; i++) {
            let key = Object.keys(ccp.peers)[i]
            let peer = ccp.peers[key]
            ccp.peers[key].url = peer.url.replace('localhost', host)
        }
        let key = Object.keys(ccp.certificateAuthorities)[0]
        ccp.certificateAuthorities[key].url = ccp.certificateAuthorities[key].url.replace('localhost', host)
        fs.writeFileSync(`./ccp/connection-${org}.json`, JSON.stringify(ccp, null, 2))
        fs.writeFileSync(`./wallet/${user}.id`, JSON.stringify(wallet))
    }
    catch (err) {
        console.log(err.message)
    }
}

function main() {
    orgs.forEach(e => {
        downloadClient(e.org, e.user)
    });
}

main()