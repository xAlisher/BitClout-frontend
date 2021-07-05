import { Component, OnInit } from "@angular/core";
import { GlobalVarsService } from "../global-vars.service";
import { AppRoutingModule } from "../app-routing.module";
import { BalanceEntryResponse } from "../backend-api.service";
import { Title } from "@angular/platform-browser";

@Component({
  selector: "wallet",
  templateUrl: "./wallet.component.html",
})
export class WalletComponent implements OnInit {
  globalVars: GlobalVarsService;
  AppRoutingModule = AppRoutingModule;
  hasUnminedCreatorCoins: boolean;
  showTransferredCoins: boolean = false;

  usersYouReceived: BalanceEntryResponse[] = [];
  usersYouPurchased: BalanceEntryResponse[] = [];

  static coinsPurchasedTab: string = "Купленные монеты";
  static coinsReceivedTab: string = "Полученные монеты";
  tabs = [WalletComponent.coinsPurchasedTab, WalletComponent.coinsReceivedTab];
  activeTab: string = WalletComponent.coinsPurchasedTab;

  constructor(private appData: GlobalVarsService, private titleService: Title) {
    this.globalVars = appData;
  }

  ngOnInit() {
    this.globalVars.loggedInUser.UsersYouHODL.map((balanceEntryResponse: BalanceEntryResponse) => {
      if (balanceEntryResponse.NetBalanceInMempool != 0) {
        this.hasUnminedCreatorCoins = true;
      }
      // If you purchased the coin or the balance entry response if for your creator coin, show it in the purchased tab.
      if (
        balanceEntryResponse.HasPurchased ||
        balanceEntryResponse.HODLerPublicKeyBase58Check === balanceEntryResponse.CreatorPublicKeyBase58Check
      ) {
        this.usersYouPurchased.push(balanceEntryResponse);
      } else {
        this.usersYouReceived.push(balanceEntryResponse);
      }
    });
    this.sortHodlings(this.usersYouPurchased);
    this.sortHodlings(this.usersYouReceived);
    this.titleService.setTitle("Кошелёк - RuClout");
  }

  sortHodlings(hodlings: BalanceEntryResponse[]): void {
    hodlings.sort((a: BalanceEntryResponse, b: BalanceEntryResponse) => {
      return (
        this.globalVars.bitcloutNanosYouWouldGetIfYouSold(b.BalanceNanos, b.ProfileEntryResponse.CoinEntry) -
        this.globalVars.bitcloutNanosYouWouldGetIfYouSold(a.BalanceNanos, a.ProfileEntryResponse.CoinEntry)
      );
    });
  }

  totalValue() {
    let result = 0;

    for (const holding of this.globalVars.loggedInUser.UsersYouHODL) {
      result +=
        this.globalVars.bitcloutNanosYouWouldGetIfYouSold(
          holding.BalanceNanos,
          holding.ProfileEntryResponse.CoinEntry
        ) || 0;
    }

    return result;
  }

  unminedBitCloutToolTip() {
    return (
      "Происходит майнинг. Но вы можете делать транзакции.\n\n" +
      "Намайнено:\n" +
      this.globalVars.nanosToBitClout(this.globalVars.loggedInUser.BalanceNanos, 9) +
      " $CLOUT.\n\n" +
      "Ненамайнено:\n" +
      this.globalVars.nanosToBitClout(this.globalVars.loggedInUser.UnminedBalanceNanos, 9) +
      " $CLOUT."
    );
  }

  unminedCreatorCoinToolTip(creator: any) {
    return (
      "Происходит майнинг. Но вы можете делать транзакции.\n\n" +
      "Баланс без ненамайненных транзакций:\n" +
      this.globalVars.nanosToBitClout(creator.NetBalanceInMempool, 9) +
      " $CLOUT.\n\n" +
      "Баланс с ненамайненными транзакциями:\n" +
      this.globalVars.nanosToBitClout(creator.BalanceNanos, 9) +
      " $CLOUT.\n\n"
    );
  }

  usernameTruncationLength(): number {
    return this.globalVars.isMobile() ? 14 : 20;
  }

  emptyHodlerListMessage(): string {
    return this.showTransferredCoins
      ? "Вы еще не получили авторских монет, которыми еще не владели."
      : "Вы еще не купили авторских монет.";
  }

  _handleTabClick(tab: string) {
    this.showTransferredCoins = tab === WalletComponent.coinsReceivedTab;
    this.activeTab = tab;
  }
}
