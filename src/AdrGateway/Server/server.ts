import "reflect-metadata";

import express from "express";
import { JWKS } from "jose";
import { injectable, inject, registry } from "tsyringe";
import winston from "winston";
import { DataHolderMetadataProvider, DataholderMetadata, Dataholder } from "../Services/DataholderMetadata";
import bodyParser from "body-parser";
import { AdrGatewayConfig } from "../Config";
import { ConsentConfirmationMiddleware } from "./Middleware/ConsentConfirmation";
import * as _ from "lodash"
import { ConsentRequestMiddleware } from "./Middleware/ConsentRequest";
import { ConsumerDataAccessMiddleware } from "./Middleware/ConsumerDataAccess";
import { ConsentListingMiddleware } from "./Middleware/ConsentListing";
import { ConsentDeletionMiddleware } from "./Middleware/ConsentDeletion";
import cors from "cors";
import { UserInfoProxyMiddleware } from "./Middleware/UserInfo";
import { DefaultPathways } from "./Connectivity/Pathways";
import { ConsentDetailsMiddleware } from "./Middleware/ConsentDetails";
import { CatchPromiseRejection } from "./Middleware/ErrorHandling";

@injectable()
class AdrGateway {
    constructor(
        @inject("Logger") private logger:winston.Logger,
        @inject("AdrGatewayConfig") private config:(() => Promise<AdrGatewayConfig>),
        @inject("DataHolderMetadataProvider") private dataHolderMetadataProvider: DataHolderMetadataProvider<Dataholder>,
        private consentConfirmationMiddleware: ConsentConfirmationMiddleware,
        private consentRequestMiddleware: ConsentRequestMiddleware,
        private consentListingMiddleware: ConsentListingMiddleware,
        private consentDetailsMiddleware: ConsentDetailsMiddleware,
        private consentDeletionMiddleware: ConsentDeletionMiddleware,
        private consumerDataAccess: ConsumerDataAccessMiddleware,
        private userInfo: UserInfoProxyMiddleware,
        private pw:DefaultPathways
    ) {}

    init(): any {
        /**
         * API is defined here: https://app.swaggerhub.com/apis/Reg-Aust-Bank/DataRecipientMiddleware/1.0.0#/
         */
        const app = express();
               
        app.get( "/jwks", async ( req, res ) => {
            // output the public portion of the key
          
            res.setHeader("content-type","application/json");
            let jwks = await this.pw.DataRecipientJwks().GetWithHealing();
            res.json(jwks.toJWKS());
            this.logger.info("Someone requested JWKS")
            
        } );

        app.get( "/cdr/data-holders", async ( req, res ) => {
            let dataholders = await this.dataHolderMetadataProvider.getDataHolders();
            res.json(_.map(dataholders,dh => _.pick(dh,'dataHolderBrandId','brandName','logoUri','industry','legalEntityName','websiteUri','abn','acn')));
            
        } );

        app.get( "/cdr/consents",
            this.consentListingMiddleware.handler()
        );


        // TODO test and fix invalid data holder id returns 404 (currently returns 500)
        app.post( "/cdr/consents",
            bodyParser.json(),
            this.consentRequestMiddleware.handler()
        );

        /**
         * Handles response from data holder, performing token checking and database update
         * This is the OAuth2 Authorization Redirection Endpoint https://tools.ietf.org/html/rfc6749#section-3.1.2
         * Validation defined here: https://openid.net/specs/openid-connect-core-1_0.html#HybridAuthResponse
         */
        app.get( "/cdr/consents/:consentId",
            this.consentDetailsMiddleware.handler()
        );

        app.patch( "/cdr/consents/:consentId",
            bodyParser.json(),
            CatchPromiseRejection(this.consentConfirmationMiddleware.handle)
        );

        app.options( "/cdr/consents/:consentId",
            cors({
                methods:['GET','PATCH','POST']
            })
        );


        app.delete( "/cdr/consents/:consentId",
            this.consentDeletionMiddleware.handler()
        );

        // TODO fix consumerDataAccess.handler routes - promise rejections to return 400 or something else, not hang forever
        app.get("/cdr/consents/:consentId/accounts",
            this.consumerDataAccess.handler('/cds-au/v1/banking/accounts','bank:accounts.basic:read')
        )

        app.get("/cdr/consents/:consentId/accounts/balances",
            this.consumerDataAccess.handler('/cds-au/v1/banking/accounts/balances','bank:accounts.basic:read')
        )

        app.get("/cdr/consents/:consentId/accounts/:accountId/balance",
            this.consumerDataAccess.handler(p => `/cds-au/v1/banking/accounts/${p.accountId}/balance`,'bank:accounts.basic:read')
        )

        app.get("/cdr/consents/:consentId/accounts/:accountId",
            this.consumerDataAccess.handler(p => `/cds-au/v1/banking/accounts/${p.accountId}`,'bank:accounts.detail:read')
        )

        app.get("/cdr/consents/:consentId/accounts/:accountId/transactions",
            this.consumerDataAccess.handler(p => `/cds-au/v1/banking/accounts/${p.accountId}/transactions`,'bank:transactions:read')
        )

        app.get("/cdr/consents/:consentId/consumerInfo",
            this.consumerDataAccess.handler('/cds-au/v1/common/customer','common:customer.basic:read')
        )

        app.get("/cdr/consents/:consentId/userInfo",
            this.userInfo.handler()
        );
      
        // Test hook
        (<any>app).pw = this.pw;

        return app;
       
    }
}

export {AdrGateway}