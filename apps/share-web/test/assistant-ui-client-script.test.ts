import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createAssistantUiShareClientScript } from "../src/pages/share/assistantUiClientScript.ts";

test("assistant-ui share client script lives in share-web and owns browser runtime behavior", () => {
  const script = createAssistantUiShareClientScript();

  assert.match(script, /assistant-ui-state/);
  assert.match(script, /ralphloop:assistant-ui:threads:/);
  assert.match(script, /format=ag-ui/);
  assert.match(script, /assistant-ui-preview-toggle/);
  assert.match(script, /assistant-ui-preview-drawer/);
  assert.match(script, /\/preview\?sessionId=/);
  assert.match(script, /Agent 正在处理/);
  assert.match(script, /当前会话已失效，请新建会话后重试。/);
  assert.match(script, /任务提交失败，请稍后重试。/);
  assert.match(script, /任务已取消。/);
  assert.doesNotMatch(script, /cost|budget|tokenHash|deviceKey|bootstrap|模型价格/i);

  const gatewaySource = readFileSync(
    new URL("../../share-gateway/src/productization/httpServer.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(gatewaySource, /function assistantUiShareClientScript\(/);
});
