-- Remove demobilizer-era agency banking tables and enums that are not part of RentSure.

DROP TABLE IF EXISTS "LimitRoleTemplateLimit" CASCADE;
DROP TABLE IF EXISTS "LimitRoleTemplate" CASCADE;
DROP TABLE IF EXISTS "RoleTransactionLimit" CASCADE;
DROP TABLE IF EXISTS "AgentTransactionLimit" CASCADE;
DROP TABLE IF EXISTS "TransactionPolicy" CASCADE;
DROP TABLE IF EXISTS "LoanInstallment" CASCADE;
DROP TABLE IF EXISTS "LoanProduct" CASCADE;
DROP TABLE IF EXISTS "LoanRequest" CASCADE;
DROP TABLE IF EXISTS "WalletBalanceCache" CASCADE;
DROP TABLE IF EXISTS "AccountOpeningApplication" CASCADE;
DROP TABLE IF EXISTS "FinancialTransaction" CASCADE;
DROP TABLE IF EXISTS "IntegrationProvider" CASCADE;
DROP TABLE IF EXISTS "CashRequest" CASCADE;
DROP TABLE IF EXISTS "FloatLedger" CASCADE;
DROP TABLE IF EXISTS "Transaction" CASCADE;
DROP TABLE IF EXISTS "SystemCounter" CASCADE;
DROP TABLE IF EXISTS "Customer" CASCADE;
DROP TABLE IF EXISTS "Outlet" CASCADE;

DROP TYPE IF EXISTS "PolicyFeeMode";
DROP TYPE IF EXISTS "IntegrationAuthType";
DROP TYPE IF EXISTS "IntegrationProviderType";
DROP TYPE IF EXISTS "LoanRepaymentSource";
DROP TYPE IF EXISTS "LoanInstallmentStatus";
DROP TYPE IF EXISTS "LoanRequestStatus";
DROP TYPE IF EXISTS "AccountOpeningStatus";
DROP TYPE IF EXISTS "PayloadProtectionMode";
DROP TYPE IF EXISTS "FinancialChannel";
DROP TYPE IF EXISTS "FinancialTransactionStatus";
DROP TYPE IF EXISTS "FinancialTransactionType";
DROP TYPE IF EXISTS "CustomerTitle";
DROP TYPE IF EXISTS "FloatDirection";
DROP TYPE IF EXISTS "CashRequestStatus";
DROP TYPE IF EXISTS "TransactionStatus";
DROP TYPE IF EXISTS "TransactionType";
DROP TYPE IF EXISTS "OutletStatus";
