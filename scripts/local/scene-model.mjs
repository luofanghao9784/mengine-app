// Only the supervisor's explicitly validated model environment enables this service.
export function sceneModel(env) {
  if (!env.AGENT_MODEL_PROVIDER) return {enabled:false,apiKey:'',baseUrl:'https://disabled.invalid',model:'disabled'};
  const provider = env.AGENT_MODEL_PROVIDER;
  if (!env.AGENT_MODEL_API_KEY || !env.AGENT_MODEL_NAME) throw Error('Scene model configuration incomplete');
  let baseUrl;
  if (provider === 'deepseek' && env.AGENT_MODEL_NAME === 'deepseek-flash') {
    baseUrl = 'https://api.deepseek.com';
  } else if (provider === 'bailian' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(env.AGENT_BAILIAN_WORKSPACE_ID || '')) {
    const host = /^\d+$/.test(env.AGENT_BAILIAN_WORKSPACE_ID) ? 'dashscope.aliyuncs.com' : `${env.AGENT_BAILIAN_WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com`;
    baseUrl = `https://${host}/compatible-mode/v1`;
  } else throw Error('Scene model provider configuration invalid');
  return {enabled:true,provider,apiKey:env.AGENT_MODEL_API_KEY,baseUrl,model:env.AGENT_MODEL_NAME};
}
