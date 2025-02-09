// src/address.ts

import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
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
            try {
                if (publicKey.startsWith('0x')) {
                    pubKeyBytes = Uint8Array.from(Buffer.from(publicKey.slice(2), 'hex'));
                } else if (/^[0-9a-fA-F]+$/.test(publicKey)) {
                    pubKeyBytes = Uint8Array.from(Buffer.from(publicKey, 'hex'));
                } else {
                    pubKeyBytes = Uint8Array.from(Buffer.from(publicKey, 'base64'));
                }
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                throw new Error(`Invalid public key format: ${errorMessage}`);
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
        // Validate ETH address format first
        if (!this.isEthAddress(ethAddress)) {
            throw new Error('Invalid ETH address format');
        }

        // Remove '0x' prefix if present and convert to Buffer
        try {
            const cleanAddress = ethAddress.replace('0x', '').toLowerCase();
            if (!/^[0-9a-f]{40}$/.test(cleanAddress)) {
                throw new Error('Invalid ETH address characters');
            }
            
            const addressBytes = Buffer.from(cleanAddress, 'hex');
            if (addressBytes.length !== 20) {
                throw new Error('Invalid ETH address length');
            }
            
            const words = this.convertBits(addressBytes, 8, 5, true);
            return bech32.encode(prefix, words, 256);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Invalid ETH address: ${errorMessage}`);
        }
    }

    static isEthAddress(address: string): boolean {
        return /^0x[0-9a-fA-F]{40}$/.test(address);
    }
}