import { derivationPathToString } from '@swapkit/helpers';
import type {
  BaseUTXOToolbox,
  BCHToolbox,
  Psbt,
  UTXOToolbox,
  UTXOTransferParams,
} from '@swapkit/toolbox-utxo';
import type { DerivationPathArray, UTXOChain } from '@swapkit/types';
import { Chain, DerivationPath, FeeOption } from '@swapkit/types';

import { bip32ToAddressNList, ChainToKeepKeyName } from '../helpers/coins.ts';

type KKUtxoWalletParams = {
  sdk: any;
  chain: UTXOChain;
  derivationPath?: DerivationPathArray;
  apiKey?: string;
  apiClient?: ReturnType<typeof BaseUTXOToolbox>['apiClient'];
};

interface psbtTxOutput {
  address: string;
  script: Buffer;
  value: number;
  change?: boolean; // Optional, assuming it indicates if the output is a change
}
interface ExtendedPsbt extends Psbt {
  txOutputs: psbtTxOutput[];
}
interface KeepKeyInputObject {
  addressNList: number[];
  scriptType: string;
  amount: string;
  vout: number;
  txid: string;
  hex: string;
}

export const utxoWalletMethods = async ({
  sdk,
  chain,
  derivationPath,
  apiKey,
  apiClient,
}: KKUtxoWalletParams): Promise<
  UTXOToolbox & {
    getAddress: () => string;
    signTransaction: (
      psbt: ExtendedPsbt,
      inputs: KeepKeyInputObject[],
      memo?: string,
    ) => Promise<string>;
    transfer: (params: UTXOTransferParams) => Promise<string>;
  }
> => {
  if (!apiKey && !apiClient) throw new Error('UTXO API key not found');
  const { getToolboxByChain } = await import('@swapkit/toolbox-utxo');

  const toolbox = getToolboxByChain(chain)({ apiClient, apiKey });
  const scriptType = [Chain.Bitcoin, Chain.Litecoin].includes(chain) ? 'p2wpkh' : 'p2pkh';

  const derivationPathString = !derivationPath
    ? DerivationPath[chain]
    : `m/${derivationPathToString(derivationPath)}`;

  const addressInfo = {
    coin: ChainToKeepKeyName[chain],
    script_type: scriptType,
    address_n: bip32ToAddressNList(derivationPathString),
  };

  const { address: walletAddress } = await sdk.address.utxoGetAddress(addressInfo);

  const signTransaction = async (psbt: Psbt, inputs: KeepKeyInputObject[], memo: string = '') => {
    const outputs = psbt.txOutputs
      .map((output) => {
        const { value, address, change } = output as psbtTxOutput;

        const outputAddress =
          chain === Chain.BitcoinCash
            ? (toolbox as ReturnType<typeof BCHToolbox>).stripToCashAddress(address)
            : address;

        if (change || address === walletAddress) {
          return {
            addressNList: addressInfo.address_n,
            isChange: true,
            addressType: 'change',
            amount: value,
            scriptType,
          };
        } else {
          if (outputAddress) {
            return { address: outputAddress, amount: value, addressType: 'spend' };
          } else {
            return null;
          }
        }
      })
      .filter(Boolean);

    const removeNullAndEmptyObjectsFromArray = (arr: any[]) => {
      return arr.filter(
        (item) => item !== null && typeof item === 'object' && Object.keys(item).length !== 0,
      );
    };

    const responseSign = await sdk.utxo.utxoSignTransaction({
      coin: ChainToKeepKeyName[chain],
      inputs,
      outputs: removeNullAndEmptyObjectsFromArray(outputs),
      version: 1,
      locktime: 0,
      opReturnData: memo,
    });
    return responseSign.serializedTx;
  };

  const transfer = async ({
    from,
    recipient,
    feeOptionKey,
    feeRate,
    memo,
    ...rest
  }: UTXOTransferParams) => {
    if (!from) throw new Error('From address must be provided');
    if (!recipient) throw new Error('Recipient address must be provided');

    const { psbt, inputs: rawInputs } = await toolbox.buildTx({
      ...rest,
      memo,
      feeOptionKey,
      recipient,
      feeRate: feeRate || (await toolbox.getFeeRates())[feeOptionKey || FeeOption.Fast],
      sender: from,
      fetchTxHex: chain,
    });

    const inputs = rawInputs.map(({ value, index, hash, txHex }) => ({
      //@TODO don't hardcode master, lookup on blockbook what input this is for and what path that address is!
      addressNList: addressInfo.address_n,
      scriptType,
      amount: value.toString(),
      vout: index,
      txid: hash,
      hex: txHex || '',
    }));

    const txHex = await signTransaction(psbt, inputs, memo);
    return toolbox.broadcastTx(txHex);
  };

  return { ...toolbox, getAddress: () => walletAddress as string, signTransaction, transfer };
};