import type { Keplr } from "@keplr-wallet/types";
import { type AssetValue, setRequestClientConfig } from "@swapkit/helpers";
import type { ConnectWalletParams, WalletTxParams } from "@swapkit/types";
import { Chain, ChainId, ChainToChainId, RPCUrl, WalletOption } from "@swapkit/types";
import { chainRegistry } from "./chainRegistry.ts";

declare global {
  interface Window {
    keplr: Keplr;
  }
}

const keplrSupportedChainIds = [ChainId.Cosmos];

const connectKeplr =
  ({ addChain, config: { thorswapApiKey }, rpcUrls }: ConnectWalletParams) =>
  async (chain: Chain.Cosmos | Chain.Kujira) => {
    setRequestClientConfig({ apiKey: thorswapApiKey });

    const keplrClient = window.keplr;
    const chainId = ChainToChainId[chain];

    if (!keplrSupportedChainIds.includes(chainId)) {
      const chainConfig = chainRegistry.get(chainId);
      if (!chainConfig) throw new Error(`Unsupported chain ${chain}`);
      await keplrClient.experimentalSuggestChain(chainConfig);
    }

    keplrClient?.enable(chainId);
    const offlineSigner = keplrClient?.getOfflineSignerOnlyAmino(chainId);
    if (!offlineSigner) throw new Error("Could not load offlineSigner");
    const { getDenom, createSigningStargateClient, KujiraToolbox, GaiaToolbox } = await import(
      "@swapkit/toolbox-cosmos"
    );

    const cosmJS = await createSigningStargateClient(
      rpcUrls[chain] || RPCUrl.Cosmos,
      offlineSigner,
    );

    const [{ address }] = await offlineSigner.getAccounts();
    const transfer = async ({
      assetValue,
      recipient,
      memo,
    }: WalletTxParams & { assetValue: AssetValue }) => {
      const coins = [
        {
          denom: chain === Chain.Cosmos ? "uatom" : getDenom(assetValue.symbol),
          amount: assetValue.getBaseValue("string"),
        },
      ];

      const { transactionHash } = await cosmJS.sendTokens(address, recipient, coins, 1.6, memo);
      return transactionHash;
    };

    const toolbox = chain === Chain.Kujira ? KujiraToolbox() : GaiaToolbox();

    addChain({
      chain,
      ...toolbox,
      transfer,
      address,
      balance: [],
      walletType: WalletOption.KEPLR,
    });
  };

export const keplrWallet = {
  connectMethodName: "connectKeplr" as const,
  connect: connectKeplr,
};
