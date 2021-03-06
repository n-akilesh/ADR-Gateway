import { Dictionary } from "../../../Common/Server/Types";
import _ from "lodash"
import { DefaultPathways } from "../../../AdrGateway/Server/Connectivity/Pathways";
import { MockRegisterConfig } from "../Server/Config";
import { TestPKI } from "../../../Tests/EndToEnd/Helpers/PKI";
import { axios } from "../../../Common/Axios/axios";
import { DefaultClientCertificateInjector } from "../../../AdrGateway/Services/ClientCertificateInjection";

export const DataHolders = async (config:MockRegisterConfig,pw:DefaultPathways):Promise<any[]> => {

    let certs = await TestPKI.TestConfig();
    let mtls = new DefaultClientCertificateInjector({ca:certs.caCert});   
    let testDhUrls:Dictionary<string> = config.TestDataHolders;

    let promises:Promise<any[]>[] = [];
    let testDhs = Promise.all(_.map(Object.entries(testDhUrls), async ([id,url]) => {
        return await _.merge({
            "dataHolderBrandId": id
        },(await axios.get(url,mtls.inject({responseType:"json"}))).data)
    }))
    promises.push(testDhs)

    if (config.LiveRegisterProxy.BrandId) {
        promises.push(pw.DataHolderBrands().GetWithHealing());
    }
    
    let results = await Promise.all(promises)
    return _.flatten(results);
}