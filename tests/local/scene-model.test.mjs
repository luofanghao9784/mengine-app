import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sceneModel} from '../../scripts/local/scene-model.mjs';
test('scene model remains off without explicit supervisor configuration',()=>{
  assert.equal(sceneModel({DASHSCOPE_API_KEY:'ambient'}).enabled,false);
  assert.throws(()=>sceneModel({AGENT_MODEL_PROVIDER:'deepseek'}));
  assert.throws(()=>sceneModel({AGENT_MODEL_PROVIDER:'unknown',AGENT_MODEL_NAME:'x',AGENT_MODEL_API_KEY:'synthetic'}));
});
test('scene model uses fixed provider endpoint and explicit model',()=>{
  const env={AGENT_MODEL_PROVIDER:'deepseek',AGENT_MODEL_NAME:'deepseek-flash',AGENT_MODEL_API_KEY:'synthetic',AGENT_MODEL_BASE_URL:'https://foreign.invalid'};
  assert.equal(sceneModel(env).baseUrl,'https://api.deepseek.com');
  assert.equal(sceneModel(env).provider,'deepseek');
  assert.throws(()=>sceneModel({...env,AGENT_MODEL_NAME:'unknown'}));
});
