import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  localDeskSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  getCustodianBalances(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint[]];
  getTotalLiabilities(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  getEpochSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  getAuditorSecretTag(context: __compactRuntime.WitnessContext<Ledger, PS>,
                      auditorPk_0: Uint8Array,
                      epochVal_0: bigint): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  attestSolvency(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  grantAuditorDisclosure(context: __compactRuntime.CircuitContext<PS>,
                         auditorPk_0: Uint8Array,
                         targetEpoch_0: bigint): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  tightenCovenantPolicy(context: __compactRuntime.CircuitContext<PS>,
                        newMinRatioBps_0: bigint,
                        newMaxSingleBps_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type ProvableCircuits<PS> = {
  attestSolvency(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  grantAuditorDisclosure(context: __compactRuntime.CircuitContext<PS>,
                         auditorPk_0: Uint8Array,
                         targetEpoch_0: bigint): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  tightenCovenantPolicy(context: __compactRuntime.CircuitContext<PS>,
                        newMinRatioBps_0: bigint,
                        newMaxSingleBps_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type PureCircuits = {
  deriveEntityCommitment(sk_0: Uint8Array): Uint8Array;
  computeReserveRoot(b0_0: bigint,
                     b1_0: bigint,
                     b2_0: bigint,
                     b3_0: bigint,
                     liabilities_0: bigint,
                     salt_0: Uint8Array): Uint8Array;
  computeNullifier(sk_0: Uint8Array, epochVal_0: bigint, salt_0: Uint8Array): Uint8Array;
  computeGrantKey(auditorPk_0: Uint8Array, targetEpoch_0: bigint): Uint8Array;
}

export type Circuits<PS> = {
  deriveEntityCommitment(context: __compactRuntime.CircuitContext<PS>,
                         sk_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  computeReserveRoot(context: __compactRuntime.CircuitContext<PS>,
                     b0_0: bigint,
                     b1_0: bigint,
                     b2_0: bigint,
                     b3_0: bigint,
                     liabilities_0: bigint,
                     salt_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  computeNullifier(context: __compactRuntime.CircuitContext<PS>,
                   sk_0: Uint8Array,
                   epochVal_0: bigint,
                   salt_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  computeGrantKey(context: __compactRuntime.CircuitContext<PS>,
                  auditorPk_0: Uint8Array,
                  targetEpoch_0: bigint): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  attestSolvency(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  grantAuditorDisclosure(context: __compactRuntime.CircuitContext<PS>,
                         auditorPk_0: Uint8Array,
                         targetEpoch_0: bigint): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  tightenCovenantPolicy(context: __compactRuntime.CircuitContext<PS>,
                        newMinRatioBps_0: bigint,
                        newMaxSingleBps_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type Ledger = {
  readonly epoch: bigint;
  readonly attestationCount: bigint;
  readonly entityCommitment: Uint8Array;
  readonly covenantMinRatioBps: bigint;
  readonly covenantMaxSingleBps: bigint;
  readonly lastSolvencyRoot: Uint8Array;
  readonly lastSolvencyVerified: boolean;
  readonly lastAttestedEpoch: bigint;
  usedNullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  auditorGrants: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
}

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               initialMinRatioBps_0: bigint,
               initialMaxSingleBps_0: bigint): Promise<__compactRuntime.ConstructorResult<PS>>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
export declare const expectedVk: Record<string, string>;
export declare const circuitSignatures: __compactRuntime.CircuitSignatures;
export declare const declaredInterfaces: __compactRuntime.DeclaredInterfaces;
