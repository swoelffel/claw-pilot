import noEnterpriseFlag from "./rules/no-enterprise-flag.js";
import noDirectSecretAccess from "./rules/no-direct-secret-access.js";

export default {
  rules: {
    "no-enterprise-flag": noEnterpriseFlag,
    "no-direct-secret-access": noDirectSecretAccess,
  },
};
