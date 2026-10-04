import { useRequestLock } from '../shared/request-guard';
import { Select } from '../shared/Select';
import { useState } from 'react';
import type { RecoveryReceipt, RecoveryRequest } from '../../contracts/public-api/governance';
import { Button, Field } from '../shared/ui';
import { useSubmission, SubmitError, FormActions } from '../shared/admin';
import { governanceClient as api } from './client';
export function RecoveryForm({ tenant, platform = false }: { tenant: string; platform?: boolean }) {
  const [reason, setReason] = useState<RecoveryRequest['reason']>('OWNER_UNAVAILABLE'),
    [receipt, setReceipt] = useState<RecoveryReceipt>();
  const task = useSubmission<RecoveryRequest['reason']>();
  useRequestLock(task.busy || task.uncertain);
  return (
    <section className="governance-section">
      {!platform && <h3>负责人恢复受理</h3>}
      <p className="muted">
        登记失联或存量责任未核实的情况，等待核验。提交申请不会恢复账号、指定接班人或授予内容访问权。
      </p>
      {receipt ? (
        <div role="status">
          <strong>已登记，待核验</strong>
          <p>
            申请编号：<code>{receipt.id}</code>
          </p>
          <p className="muted">
            {new Date(receipt.createdAt).toLocaleString('zh-CN')} · 尚未完成身份核验或恢复
          </p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void task.submit(reason, async (reason, requestId) =>
              setReceipt(
                await (platform ? api.platformRecovery : api.recovery)(tenant, { reason, requestId }),
              ),
            );
          }}
        >
          <fieldset disabled={task.busy || task.uncertain}>
            <Field label="恢复申请原因">
              <Select
                aria-label="恢复申请原因"
                value={reason}
                onChange={(e) => setReason(e.target.value as RecoveryRequest['reason'])}
              >
                <option value="OWNER_UNAVAILABLE">负责人无法履职或无法登录</option>
                <option value="LEGACY_OWNER_UNVERIFIED">存量企业的负责人尚未核实</option>
              </Select>
            </Field>
          </fieldset>
          <SubmitError error={task.error} uncertain={task.uncertain} />
          <FormActions>
            <Button type="submit" disabled={task.busy}>
              {task.uncertain ? '重试本次登记' : '登记待核验申请'}
            </Button>
          </FormActions>
        </form>
      )}
    </section>
  );
}
