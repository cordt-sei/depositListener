// src/address.ts
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { keccak_256 } from '@noble/hashes/sha3';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bech32 } from 'bech32';

export class AddressUtils {
    static convertBits(data: Uint8Array, fromBits: number, toBits: number, pad: boolean): number[] {
        let acc = 0;
        let bits = 0;
        const result: number[] = [];
        const maxv = (1 << toBits) - 1;

        for (const value of data) {
            acc = (acc << fromBits) | value;
            bits += fromBits;
            while (bits >= toBits) {
                bits -= toBits;
                result.push((acc >> bits) & maxv);
            }
        }

        if (pad) {
            if (bits > 0) {
                result.push((acc << (toBits - bits)) & maxv);
            }
        } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
            throw new Error('Unable to convert bits');
        }

        return result;
    }

    static pubKeyToAddress(publicKey: Uint8Array | string, prefix: string): string {
        let pubKeyBytes: Uint8Array;
        
        if (typeof publicKey === 'string') {
            // Handle both hex and base64
            try {
                if (publicKey.startsWith('0x')) {
                    pubKeyBytes = Uint8Array.from(Buffer.from(publicKey.slice(2), 'hex'));
                } else if (/^[0-9a-fA-F]+$/.test(publicKey)) {
                    pubKeyBytes = Uint8Array.from(Buffer.from(publicKey, 'hex'));
                } else {
                    pubKeyBytes = Uint8Array.from(Buffer.from(publicKey, 'base64'));
                }
            } catch (e) {
                throw new Error(`Invalid public key format: ${e.message}`);
            }
        } else {
            pubKeyBytes = publicKey;
        }

        const sha256Hash = sha256(pubKeyBytes);
        const ripemd160Hash = ripemd160(sha256Hash);
        const words = this.convertBits(ripemd160Hash, 8, 5, true);
        
        return bech32.encode(prefix, words, 256);
    }

    static ethAddressToBech32(ethAddress: string, prefix: string): string {
        // Remove '0x' prefix if present and convert to Buffer
        const addressBytes = Buffer.from(ethAddress.replace('0x', ''), 'hex');
        const words = this.convertBits(addressBytes, 8, 5, true);
        
        return bech32.encode(prefix, words, 256);
    }

    static isEthAddress(address: string): boolean {
        return /^0x[0-9a-fA-F]{40}$/.test(address);
    }
}
