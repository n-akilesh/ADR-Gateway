import { Neuron } from "../../../../Common/Connectivity/Neuron";
import { JWKS } from "jose";
import { DataholderOidcResponse } from "./DataholderRegistration";
import { DataHolderRegistration } from "../../../Entities/DataHolderRegistration";
import { ConsentRequestLog, ConsentRequestLogManager } from "../../../Entities/ConsentRequestLog";
import { CreateAssertion } from "../Assertions";
import { DataholderOidcMetadata } from "../../../Services/DataholderMetadata";
import { AxiosRequestConfig } from "axios"
import { ClientCertificateInjector } from "../../../Services/ClientCertificateInjection";
import moment from "moment";
import { DefaultPathways } from "../Pathways";
import _ from "lodash"
import { injectable } from "tsyringe";
import qs from "qs"
import { axios } from "../../../../Common/Axios/axios";

export interface TokenResponse {
    "access_token":string,
    "token_type":string,
    "expires_in":number
    "refresh_token"?:string
    "scope"?:string,
    "id_token":string
}

interface CodeParams {
    "grant_type":'authorization_code',
    "code": string
}

interface RefreshTokenParams {
    "grant_type":'refresh_token',
}

export type TokenRequestParams = CodeParams | RefreshTokenParams

@injectable()
export class ConsentNewAccessTokenNeuron extends Neuron<[JWKS.KeyStore,DataholderOidcResponse,DataHolderRegistration],ConsentRequestLog> {
    constructor(
        private cert:ClientCertificateInjector,
        private consent: ConsentRequestLog,
        private params:TokenRequestParams,
        private pw: DefaultPathways,
        private consentManager: ConsentRequestLogManager
    ) {
        super()
        // the cache will be disabled for access to the authorize endpoint.
        // TODO cache?
    }

    evaluator = async ([drJwks,dhoidc,registration]:[JWKS.KeyStore,DataholderOidcResponse,DataHolderRegistration]) => {

        let additionalParams = <any>{}

        if (this.params.grant_type == 'refresh_token') {
            additionalParams["refresh_token"] = this.consent.refreshToken
        }
    
        let options:AxiosRequestConfig = {
            method:'POST',
            url: dhoidc.token_endpoint,
            data: qs.stringify(_.merge(this.params,{
                "client_id":registration.clientId,
                "client_assertion_type":"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                "client_assertion": CreateAssertion(registration.clientId,dhoidc.token_endpoint,drJwks),
                "redirect_uri": this.consent.redirectUri
            },additionalParams))
        }
    
        this.cert.inject(options);
        const tokenRequestTime = moment.utc().toDate();
        let responseJson:string = await axios.request(options);
    
        let responseObject:TokenResponse = JSON.parse(responseJson);
        
        let newClaims:{refresh_token_expires_at:number,sharing_expires_at:number};
    
        // id_token can only be relied upon to be supplied if grant_type == 'authorization_code'
        if (this.params.grant_type == 'authorization_code' || typeof responseObject.id_token == 'string') {
            newClaims = await this.pw.ValidIdTokenCode(registration.softwareProductId,registration.dataholderBrandId,responseObject.id_token).GetWithHealing() // Move to Pathways.ts
        } else {
            // otherwise, we need to get claims from user_info endpoint
            newClaims = await this.pw.ConsentUserInfo(this.consent).GetWithHealing() // Move to Pathways.ts
            // newClaims = await GetUserInfo(dataholder,responseObject.access_token,this.clientCertInjector);
        }
    
        let updatedConsent = await this.consentManager.UpdateTokens(
            this.consent.id,
            _.pick(responseObject,['access_token','token_type','expires_in','refresh_token','scope']),
            tokenRequestTime,
            newClaims.sharing_expires_at,
            newClaims.refresh_token_expires_at,
            JSON.stringify(newClaims));
        return updatedConsent;

    }
}

@injectable()
export class ValidateConsentNeuron extends Neuron<ConsentRequestLog,ConsentRequestLog> {

    constructor(){
        super()
        this.AddValidator(consent => {
            return consent.HasCurrentAccessToken()
        })
    }

    evaluator = async (arg0:ConsentRequestLog) => arg0

}
