const SEAL = require('node-seal');

class FledgeCrypto {
    constructor(seal) {
        this.seal = seal
        this.ctx = null
        this.keys = null
        this._setup = false
    }

    async setup(ctx, keys) {
        await this.setContext(ctx);
        this.setNewKeys(keys);
        return this
    }

    getKeys() {
        let keys = {}
        let ks = Object.keys(this.keys)
        for (let i=0; i<ks.length; i++) {
            keys[ks[i]] = this.keys[ks[i]].save()
        }
        return keys
    }

    destroy() {
        if (this._setup) {
            this.validateContext();
            this.ctx.delete();
            for (const k of Object.keys(this.keys)) {
                if (typeof this.keys[k] === 'string') continue
                else this.keys[k].delete()
            }
        }
    }

    encrypt(encodedString) {
        this.validateContext();
        const plainText = this.seal.PlainText();
        plainText.load(this.ctx, encodedString);
        const encryptor = this.seal.Encryptor(this.ctx, this.keys.pk);
        const cipherText = encryptor.encrypt(plainText);
        const result = cipherText.save()
        plainText.delete();
        encryptor.delete();
        cipherText.delete();
        return result;
    }

    decrypt(cipher) {
        const cipherText = this.seal.CipherText();
        cipherText.load(this.ctx, cipher);
        const decryptor = this.seal.Decryptor(this.ctx, this.keys.sk);
        const plainText = decryptor.decrypt(cipherText);
        const result = plainText.save()
        cipherText.delete()
        decryptor.delete();
        plainText.delete()
        return result;
    }

    encode(array) {
        this.validateContext();
        const encoder = this.seal.CKKSEncoder(this.ctx);
        const plainText = encoder.encode(array, 100000);
        const result = plainText.save()
        encoder.delete();
        plainText.delete();
        return result;
    }

    decode(encodedString) {
        this.validateContext();
        const plainText = this.seal.PlainText();
        plainText.load(this.ctx, encodedString);
        const decoder = this.seal.CKKSEncoder(this.ctx);
        const array = decoder.decode(plainText);
        plainText.delete();
        decoder.delete();
        return array;
    }
    
    addition(cipher1, cipher2) {
        this.validateContext();
        const cipherText1 = this.seal.CipherText();
        cipherText1.load(this.ctx, cipher1);
        const cipherText2 = this.seal.CipherText();
        cipherText2.load(this.ctx, cipher2);
        const evaluator = this.seal.Evaluator(this.ctx)
        const add = evaluator.add(cipherText1, cipherText2)
        const result = add.save()
        cipherText1.delete()
        cipherText2.delete()
        evaluator.delete()
        add.delete()
        return result
    }

    dotProduct(cipher1, cipher2) {
        this.validateContext();
        const cipherText1 = this.seal.CipherText();
        cipherText1.load(this.ctx, cipher1);
        const cipherText2 = this.seal.CipherText();
        cipherText2.load(this.ctx, cipher2);
        const evaluator = this.seal.Evaluator(this.ctx)
        const dot = evaluator.dotProduct(cipherText1, cipherText2, this.keys.rk, 
                                                this.keys.gk, this.seal.SchemeType.ckks)
        const result = dot.save()
        cipherText1.delete()
        cipherText2.delete()
        evaluator.delete()
        dot.delete()
        return result
    }

    norm(cipher1, cipher2) {
        this.validateContext();
        const cipherText1 = this.seal.CipherText()
        cipherText1.load(this.ctx, cipher1)
        const evaluator = this.seal.Evaluator(this.ctx);
        let norm
        if (cipher2 !== undefined) {
            const cipherText2 = this.seal.CipherText()
            cipherText2.load(this.ctx, cipher2)
            norm = evaluator.sub(cipherText1, cipherText2)
            cipherText2.delete()
        }
        else norm = cipherText1
        norm = evaluator.square(norm);
        norm = evaluator.relinearize(norm, this.keys.rk);
        norm = evaluator.sumElements(norm, this.keys.gk, this.seal.SchemeType.ckks);
        const result = norm.save()
        cipherText1.delete()
        evaluator.delete()
        norm.delete()
        return result;
    }

    async getSeal() {
        this.seal = await SEAL();
    }

    async setContext(ctx) {
        if (this.seal == null) {
            await this.getSeal();
        }
        let context = {};
        context.scheme = (ctx.scheme === 'CKKS') ? this.seal.SchemeType.ckks : this.seal.SchemeType.none;
        context.security = (ctx.security === 'TC128') ? this.seal.SecurityLevel.tc128 : this.seal.SecurityLevel.none;
        context.degree = ctx.degree;
        context.bitSizes = ctx.bitSizes;
    
        const params = this.seal.EncryptionParameters(context.scheme);
        params.setPolyModulusDegree(context.degree);
        params.setCoeffModulus(
            this.seal.CoeffModulus.Create(context.degree, Int32Array.from(context.bitSizes))
        )
        this.ctx = this.seal.Context(
            params,
            true,
            context.security
        );
    }

    setNewKeys(keys) {
        this.validateContext();
        if (keys === undefined) {
            const keyGenerator = this.seal.KeyGenerator(this.ctx);
            this.keys = { pk: '', sk: '', gk: '', rk: ''};
            this.keys.pk = keyGenerator.createPublicKey();
            this.keys.sk = keyGenerator.secretKey();
            this.keys.gk = keyGenerator.createGaloisKeys(Int32Array.from([]));
            this.keys.rk = keyGenerator.createRelinKeys();
        } else {
            this.keys = { pk: '', sk: '', gk: '', rk: ''};
            for (let k of Object.keys(keys)) {
                let key
                let stringKey = keys[k]
                if (k === 'pk' && stringKey.length > 0) key = this.seal.PublicKey()
                else if (k === 'sk' && stringKey.length > 0) key = this.seal.SecretKey()
                else if (k === 'gk' && stringKey.length > 0) key = this.seal.GaloisKeys()
                else if (k === 'rk' && stringKey.length > 0) key = this.seal.RelinKeys()
                else continue
                key.load(this.ctx, stringKey)
                this.keys[k] = key
            }       
        }
    }

    validateContext() {
        if (this.ctx == null) {
            throw Error('Encryption context missing. Use setContext to generate a new context')
        }
    }
}

module.exports = {
    FledgeCrypto
}