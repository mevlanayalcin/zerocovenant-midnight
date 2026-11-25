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
  ]
};
