import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Ledger } from "./managed/zero_covenant/contract/index.js";

export interface ZeroCovenantPrivateState {
  deskSecret: Uint8Array;
  custodianBalances: [bigint, bigint, bigint, bigint];
  totalLiabilities: bigint;
  epochSalt: Uint8Array;
}

export function createZeroCovenantPrivateState(opts: {
  deskSecret: Uint8Array;
  custodianBalances: [bigint, bigint, bigint, bigint];
  totalLiabilities: bigint;
  epochSalt: Uint8Array;
}): ZeroCovenantPrivateState {
  return {
    deskSecret: opts.deskSecret,
    custodianBalances: opts.custodianBalances,
    totalLiabilities: opts.totalLiabilities,
    epochSalt: opts.epochSalt
  };
}

function xorTag(a: Uint8Array, b: Uint8Array, c: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = (a[i] ?? 0) ^ (b[i] ?? 0) ^ (c[i] ?? 0);
  }
  return out;
}

export const witnesses = {
  localDeskSecret: ({
    privateState
  }: WitnessContext<Ledger, ZeroCovenantPrivateState>): [ZeroCovenantPrivateState, Uint8Array] => [
    privateState,
    privateState.deskSecret
  ],
  getCustodianBalances: ({
    privateState
  }: WitnessContext<Ledger, ZeroCovenantPrivateState>): [ZeroCovenantPrivateState, bigint[]] => [
    privateState,
    [...privateState.custodianBalances]
  ],
  getTotalLiabilities: ({
    privateState
  }: WitnessContext<Ledger, ZeroCovenantPrivateState>): [ZeroCovenantPrivateState, bigint] => [
    privateState,
    privateState.totalLiabilities
  ],
  getEpochSalt: ({
    privateState
  }: WitnessContext<Ledger, ZeroCovenantPrivateState>): [ZeroCovenantPrivateState, Uint8Array] => [
    privateState,
    privateState.epochSalt
  ],
  getAuditorSecretTag: (
    { privateState }: WitnessContext<Ledger, ZeroCovenantPrivateState>,
    auditorPk: Uint8Array,
    epochVal: bigint
  ): [ZeroCovenantPrivateState, Uint8Array] => {
    const epochMask = new Uint8Array(32);
    epochMask[31] = Number(epochVal & 0xffn);
    const tag = xorTag(privateState.deskSecret, auditorPk, xorTag(privateState.epochSalt, epochMask, new Uint8Array(32)));
    return [privateState, tag];
  }
};
