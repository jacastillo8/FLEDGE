const SEAL = require('node-seal');

import { Keys } from "../interfaces/keys"

class Context {
    constructor(public scheme = '', public security = '', 
            public degree = 2048, public bitSizes=[54]) {}
}

export class FledgeCrypto {
    private _seal: any = null
    private _ctx: any = null
    private _keys: any = null
    private _setup: boolean = false

    constructor() {}

    async setup(ctx: Context, keys?: Keys) {
        await this.setContext(ctx);
        this.setNewKeys(keys);
        this._setup = true
        return this
    }

    get keys() {
        let k: any = {}
        for (const key of Object.keys(this._keys)) {
            k[key] = this._keys[key].save()
        }
        return k
    }

    destroy() {
        if (this._setup) {
            this.validateContext();
            this._ctx.delete();
            for (const key of Object.keys(this._keys)) {
                if (typeof this._keys[key] === 'string') continue
                else this._keys[key].delete()
            }
        }
    }

    encrypt(encodedString: string) {
        this.validateContext();
        const plainText = this._seal.PlainText();
        plainText.load(this._ctx, encodedString);
        const encryptor = this._seal.Encryptor(this._ctx, this._keys.pk);
        const cipherText = encryptor.encrypt(plainText);
        const result = cipherText.save()
        plainText.delete();
        encryptor.delete();
        cipherText.delete();
        return result;
    }

    decrypt(cipher: string) {
        const cipherText = this._seal.CipherText();
        cipherText.load(this._ctx, cipher);
        const decryptor = this._seal.Decryptor(this._ctx, this._keys.sk);
        const plainText = decryptor.decrypt(cipherText);
        const result = plainText.save()
        cipherText.delete()
        decryptor.delete();
        plainText.delete()
        return result;
    }

    encode(array: Float64Array) {
        this.validateContext();
        const encoder = this._seal.CKKSEncoder(this._ctx);
        const plainText = encoder.encode(array, 100000);
        const result = plainText.save()
        encoder.delete();
        plainText.delete();
        return result;
    }

    decode(encodedString: string) {
        this.validateContext();
        const plainText = this._seal.PlainText();
        plainText.load(this._ctx, encodedString);
        const decoder = this._seal.CKKSEncoder(this._ctx);
        const array = decoder.decode(plainText);
        plainText.delete();
        decoder.delete();
        return array;
    }
    
    addition(cipher1: string, cipher2: string) {
        this.validateContext();
        const cipherText1 = this._seal.CipherText();
        cipherText1.load(this._ctx, cipher1);
        const cipherText2 = this._seal.CipherText();
        cipherText2.load(this._ctx, cipher2);
        const evaluator = this._seal.Evaluator(this._ctx)
        const add = evaluator.add(cipherText1, cipherText2)
        const result = add.save()
        cipherText1.delete()
        cipherText2.delete()
        evaluator.delete()
        add.delete()
        return result
    }

    dotProduct(cipher1: string, cipher2: string) {
        this.validateContext();
        const cipherText1 = this._seal.CipherText();
        cipherText1.load(this._ctx, cipher1);
        const cipherText2 = this._seal.CipherText();
        cipherText2.load(this._ctx, cipher2);
        const evaluator = this._seal.Evaluator(this._ctx)
        const dot = evaluator.dotProduct(cipherText1, cipherText2, this._keys.rk, 
                                                this._keys.gk, this._seal.SchemeType.ckks)
        const result = dot.save()
        cipherText1.delete()
        cipherText2.delete()
        evaluator.delete()
        dot.delete()
        return result
    }

    norm(cipher1: string, cipher2?: string) {
        this.validateContext();
        const cipherText1 = this._seal.CipherText()
        cipherText1.load(this._ctx, cipher1)
        const evaluator = this._seal.Evaluator(this._ctx);
        let norm: any
        if (cipher2 !== undefined) {
            const cipherText2 = this._seal.CipherText()
            cipherText2.load(this._ctx, cipher2)
            norm = evaluator.sub(cipherText1, cipherText2) // global - local
            cipherText2.delete()
        }
        else norm = cipherText1
        norm = evaluator.square(norm);
        norm = evaluator.relinearize(norm, this._keys.rk);
        norm = evaluator.sumElements(norm, this._keys.gk, this._seal.SchemeType.ckks);
        const result = norm.save()
        cipherText1.delete()
        evaluator.delete()
        norm.delete()
        return result;
    }

    private async getSeal() {
        this._seal = await SEAL();
    }

    private async setContext(ctx: Context) {
        if (this._seal == null) {
            await this.getSeal();
        }
        let context: any = {};
        context.scheme = (ctx.scheme === 'CKKS') ? this._seal.SchemeType.ckks : this._seal.SchemeType.none;
        context.security = (ctx.security === 'TC128') ? this._seal.SecurityLevel.tc128 : this._seal.SecurityLevel.none;
        context.degree = ctx.degree;
        context.bitSizes = ctx.bitSizes;
    
        const params = this._seal.EncryptionParameters(context.scheme);
        params.setPolyModulusDegree(context.degree);
        params.setCoeffModulus(
            this._seal.CoeffModulus.Create(context.degree, Int32Array.from(context.bitSizes))
        )
        this._ctx = this._seal.Context(
            params,
            true,
            context.security
        );
    }

    private setNewKeys(keys?: Keys) {
        this.validateContext();
        if (keys === undefined) {
            const keyGenerator = this._seal.KeyGenerator(this._ctx);
            this._keys = { pk: '', sk: '', gk: '', rk: ''};
            this._keys.pk = keyGenerator.createPublicKey();
            this._keys.sk = keyGenerator.secretKey();
            this._keys.gk = keyGenerator.createGaloisKeys(Int32Array.from([]));
            this._keys.rk = keyGenerator.createRelinKeys();
        } else {
            this._keys = { pk: '', sk: '', gk: '', rk: ''};
            for (let k of Object.keys(keys)) {
                let key: any
                let stringKey = keys[k as keyof typeof keys]
                if (k === 'pk' && stringKey.length > 0) key = this._seal.PublicKey()
                else if (k === 'sk' && stringKey.length > 0) key = this._seal.SecretKey()
                else if (k === 'gk' && stringKey.length > 0) key = this._seal.GaloisKeys()
                else if (k === 'rk' && stringKey.length > 0) key = this._seal.RelinKeys()
                else continue
                key.load(this._ctx, stringKey)
                this._keys[k] = key
            }    
        }
    }

    private validateContext() {
        if (this._ctx == null) {
            throw Error('Encryption context missing. Use setContext to generate a new context')
        }
    }
}