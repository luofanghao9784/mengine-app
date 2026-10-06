package com.dreamcore.workspace;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class ConversationNotificationReadIntegrationTest extends AttentionIntegrationTest {
 @Test void readPartialAnswerDoesNotRequireActionButUnreadReplyStillSignals(){
  var t=task(owner,personal,"PARTIAL");
  db.update("UPDATE conversation_tasks SET reply='合成部分回复' WHERE id=?",t);
  db.update("UPDATE conversations SET reply_revision=1,latest_reply_task_id=? WHERE id=(SELECT conversation_id FROM conversation_tasks WHERE id=?)",t,t);
  assertTrue(conversations.hasUnreadOrAttention(owner,tenant));
  db.update("UPDATE conversations SET read_reply_revision=1 WHERE latest_reply_task_id=?",t);
  assertFalse(conversations.hasUnreadOrAttention(owner,tenant));
  db.update("UPDATE conversation_tasks SET status='WAITING_INPUT' WHERE id=?",t);
  assertTrue(conversations.hasUnreadOrAttention(owner,tenant));
  db.update("UPDATE conversation_tasks SET status='RESULT_UNKNOWN' WHERE id=?",t);
  assertTrue(conversations.hasUnreadOrAttention(owner,tenant));
 }
}
