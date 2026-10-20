import contract from './briefing-contract.json' with { type: 'json' };
/** Single release-owned contract also packaged by the API for deployment authors. */
export const BRIEFING_WRITING_RULES_VERSION = contract.version;
export const BRIEFING_WRITING_RULES = contract.rules;
