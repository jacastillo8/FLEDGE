# FLEDGE
The following repository presents the ledger-based Federated Learning framework FLEDGE that allows making parties accountable for their behavior and achieve reasonable efficiency for mitigating inference and poisoning attacks. It includes FLEDGE's client and smart contracts, i.e., Gateway and Defender Smart Contracts, to illustrate the security properties in FLEDGE. To illustrate its operations, we have also included 45 models (30 benign and 15 malicious) for MNIST, Fashion MNIST and CIFAR10. 
## Start Here
### Directories
- `fledge_client`: Directory that contains all the corresponding code to interface with FLEDGE, the code to evaluate GKDE Defense, and the necessary models to successfully simulate a Federated Learning environment. 
- `defender_contract`: Directory that contains the Defender Smart Contract and its dependencies.
- `gateway_contract`: Directory that contains the Gateway Smart Contract and its dependencies. 
- `FLEDGE_postman_collection`: JSON document that contains the API calls to deploy FLEDGE. 
### Requirements
To run the artifacts successfully, you are required to satisfy the following prerequisites.
1. OS: Ubuntu 18, RAM: 32GB
1. Download and install Python 3.6 with its package manager (PIP). Also, install the python dependancies below.
   - Numpy 
   - SciPy 
   - PyTorch
1. Download and install NodeJS 16 with its package manager (NPM).
1. Download and install [Postman](https://www.postman.com/downloads/). 
1. Download and deploy [Blockchain Manager](https://github.com/jacastillo8/Blockchain_Manager) repository. Follow the steps found inside the manager to setup the repository. 
### Tutorial
The series of steps shown below are to be executed after successfully completing the last step in the requirements section.
1. Import postman collection `FLEDGE_postman_collection.json` into Postman.
1. Move both smart contracts (i.e., `defender_contract`, `gateway_contract`) to chaincode folder inside Blockchain Manager (see below).
   ```bash
    Blockchain_Manager
    ├── blockchain_base
    │   ├── ...
    │   ├── chaincode
    │   │   ├── defender_contract
    │   │   ├── gateway_contract
    │   └── ...
    ├── express_app
    └── postman_collection_bcapi
    ```
1. Prepare Blockchain Manager to receive commands.
    ```
    // Deploy database to hold blockchain information
    npm run mongoUp
    // Start Blockchain Manager
    npm start
    ```
1. Request Blockchain Manager to install FLEDGE via Postman `Register`.
1. Request Blockchain Manager to deploy FLEDGE via Postman `Build`. Note that you may need to "cancel" the request to avoid the manager receiving multiple "build" HTTP requests from Postman. The reason is that the manager may take some time to deploy a blockchain and install the smart contracts.
1. After the manager has instantiated both smart contracts, navigate to `fledge_client` and install its dependencies. Note you only need to install dependencies once. 
   ```
   npm install
   ```
1. To run FLEDGE, rely on the following npm commands. This script will output information about the FLEDGE process. 
   ```
   // Download blockchain client to communicate with smart contracts
   npm run getFledgeClient
   // Main function
   npm run fledgeSingleRound
   ```
1. To evaluate FLEDGE defense, navigate to `fledge_client/scripts` and use the following command. This script will output the number of benign and malicious models as detected by the defense.
   ```
   // Note you may need to substitute to "python3"
   python gkdeDefense.py
   ```
## Disclaimers
- This repository is provided as a experimental implementation for research purposes and should not be used in a production environment. We cannot guarantee security and correctness.
- The models operated inside the client (`fledge_client/models`) were trained using a modified fork of the work of [Bagdasaryan et al.](https://github.com/ebagdasa/backdoor_federated_learning) (not included).
- Model complexity will impact the performance of FLEDGE in terms of memory. Deployed docker containers from the Blockchain Manager may unexpectedly crash from memory exhaustion. For demonstration purposes, it is recommended to only operate MNIST and Fashion MNIST models as they are less complex than the others. This, however, does not apply to the artifact that evaluates the GDKE defense. 