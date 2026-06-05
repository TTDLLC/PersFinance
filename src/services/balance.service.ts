import { Accounts } from "./accounts.service.js";

export const getAccountCurrentBalance = async (accountId: string) => {
  const account = await Accounts.getAccount(accountId);
  return account ? account.getBalance({ extended: true }) : null;
};
