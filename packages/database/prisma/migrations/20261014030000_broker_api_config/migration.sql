-- Client's own broker API app + static-IP proxy settings (secrets encrypted in encryptedSecrets).
CREATE TABLE "BrokerApiConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "broker" "BrokerName" NOT NULL,
    "clientCode" TEXT,
    "proxyHost" TEXT,
    "proxyPort" INTEGER,
    "encryptedSecrets" TEXT,
    "autoLogin" BOOLEAN NOT NULL DEFAULT true,
    "consentAt" TIMESTAMP(3),
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestIp" TEXT,
    "lastTestError" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerApiConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerApiConfig_userId_broker_key" ON "BrokerApiConfig"("userId", "broker");

ALTER TABLE "BrokerApiConfig" ADD CONSTRAINT "BrokerApiConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
