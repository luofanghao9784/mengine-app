import { useState } from 'react';
import type { SharedWorkspace, TenantMember } from '../../contracts/public-api/tenant-admin';
import { tenantClient as api } from './client';
import { Button, Field, Badge } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';

export function SpaceOwnerForm({
  tenant,
  space,
  saved,
}: {
  tenant: string;
  space?: SharedWorkspace;
  saved: (space: SharedWorkspace) => void;
}) {
  const [name, setName] = useState(''),
    [description, setDescription] = useState('');
  const [draft, setDraft] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0);
  const [owner, setOwner] = useState<TenantMember | null>(null),
    [oldAccess, setOldAccess] = useState('READ');
  const data = useRemote(
    (signal) => api.members(tenant, query, 'ACTIVE', page * 20, signal),
    [tenant, query, page, attempt],
  );
  const task = useSubmission<{
    name: string;
    description: string;
    ownerId: string;
    previousAccess: string;
  }>();
  const locked = task.busy || task.uncertain;
  useRequestLock(locked);
  return (
    <form
      className="platform-form space-owner-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!owner) return;
        void task.submit(
          {
            name: name.trim(),
            description: description.trim(),
            ownerId: owner.accountId,
            previousAccess: oldAccess,
          },
          async (body, requestId) => {
            const result = space
              ? await api.changeOwner(tenant, space.id, {
                  requestId,
                  expectedVersion: space.version,
                  ownerId: body.ownerId,
                  previousAccess: body.previousAccess,
                })
              : await api.createSpace(tenant, {
                  requestId,
                  name: body.name,
                  description: body.description,
                  ownerId: body.ownerId,
                });
            saved(result);
          },
        );
      }}
    >
      <fieldset disabled={locked}>
        {!space && (
          <>
            <Field label="空间名称">
              <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="空间说明（选填）">
              <textarea
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </>
        )}
        <h3>{space ? '选择新负责人' : '选择负责人'}</h3>
        {owner ? (
          <p>
            已选择：<strong>{owner.displayName}</strong> · {owner.phone || owner.email}{' '}
            <Button variant="ghost" onClick={() => setOwner(null)}>
              重新选择
            </Button>
          </p>
        ) : (
          <>
            <div className="platform-filters">
              <input
                aria-label="搜索空间负责人"
                placeholder="姓名或手机号"
                value={draft}
                maxLength={100}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setQuery(draft.trim());
                    setPage(0);
                  }
                }}
              />
              <Button
                onClick={() => {
                  setQuery(draft.trim());
                  setPage(0);
                }}
              >
                搜索
              </Button>
            </div>
            {data.error ? (
              <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
            ) : !data.value ? (
              <Loading />
            ) : (
              <>
                <ul className="tenant-rows">
                  {data.value.slice(0, 20).map((member) => (
                    <li key={member.accountId}>
                      <span className="tenant-person">
                        <strong>{member.displayName}</strong>
                        <small>{member.phone || member.email}</small>
                      </span>
                      {member.accountId === space?.ownerId ? (
                        <Badge>当前负责人</Badge>
                      ) : (
                        <Button disabled={member.accountStatus !== 'ACTIVE'} onClick={() => setOwner(member)}>
                          选择
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {!data.value.length && <p>没有匹配成员，可调整搜索条件。</p>}
                <Pager page={page} next={data.value.length > 20} onPage={setPage} />
              </>
            )}
          </>
        )}
        {space?.ownerId && (
          <Field label={`原负责人 ${space.ownerName} 的后续权限`}>
            <select value={oldAccess} onChange={(e) => setOldAccess(e.target.value)}>
              <option value="READ">保留只读</option>
              <option value="MAINTAIN">保留资料维护</option>
              <option value="REMOVE">移出空间</option>
            </select>
          </Field>
        )}
      </fieldset>
      <p className="platform-help">
        {owner ? owner.displayName : '所选负责人'}将获得本空间的查看、资料维护和成员授权权限。
        {space
          ? '原负责人职责同步撤销；资料和作者记录保留。'
          : '创建者选择其他负责人时，不会自动获得内容访问权。'}
      </p>
      {space?.ownerId && (
        <p className="platform-help">
          原负责人将
          {oldAccess === 'READ' ? '保留只读权限' : oldAccess === 'MAINTAIN' ? '保留资料维护权限' : '移出空间'}
          。已停用的企业成员身份不会因此恢复。
        </p>
      )}
      <SubmitError error={task.error} uncertain={task.uncertain} />
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={task.busy || !owner || (!space && !name.trim())}>
          {task.busy
            ? '正在提交…'
            : task.uncertain
              ? '核对并重试'
              : space
                ? '确认负责人变更'
                : '创建空间并授权'}
        </Button>
      </div>
    </form>
  );
}
