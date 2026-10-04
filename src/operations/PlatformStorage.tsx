import { OperationRetentionStatus } from '../retention/OperationRetentionStatus';
import { useState } from 'react';
import { ArrowLeft, RefreshCw, HardDrive, Database, Archive, ShieldCheck } from 'lucide-react';
import type {
  BackupCommand,
  BackupEvent,
  BackupObservation,
  StorageStatus,
} from '../../contracts/public-api/storage-status';
import { adminHref } from '../admin/navigation';
import { Button, Badge } from '../shared/ui';
import { Failure, Loading, useRemote } from '../shared/admin';
import { storageClient as api } from './storage-client';
import './storage.css';
const time = (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '暂无记录');
const bytes = (n: number | null): string => {
  if (n === null) return '未知';
  const unit = n < 1024 ? 0 : Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** unit).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`;
};
const commands: Record<BackupCommand, string> = {
  CREATE: '生成备份',
  VERIFY: '完整性校验',
  RESTORE: '隔离还原',
  REPACK: '复制备份',
  ROTATE: '保留期清理',
  RECONCILE: '当前权限核对',
  ACTIVATE: '开放恢复实例',
};
const descriptions: Record<BackupCommand, string> = {
  CREATE: '备份已生成，不代表完成还原验证。',
  VERIFY: '文件完整性校验通过，不代表完成数据库还原。',
  RESTORE: '在隔离目录完成还原验证，尚不代表对外开放。',
  REPACK: '已复制并校验副本。',
  ROTATE: '本次保留期清理已完成。',
  RECONCILE: '当时的当前权限与删除状态已核对，恢复实例仍隔离。',
  ACTIVATE: '当时已完成开放校验；不代表当前实例仍在运行。',
};
const stateNames = { RUNNING: '执行中', SUCCEEDED: '已完成', FAILED: '未完成', UNKNOWN: '结果待核对' };
function observationNote(b: BackupObservation) {
  return b.state === 'NOT_CONFIGURED'
    ? '尚未接入备份监测，备份情况未知。'
    : b.state === 'UNAVAILABLE'
      ? '暂时无法读取部署记录，备份情况未知。'
      : b.state === 'STALE'
        ? '部署记录已过期。下方保留历史事实，当前情况需重新核对。'
        : '最近有部署记录。各阶段结果独立，记录不保证恢复点当前仍可用。';
}
export function StorageAlert({ hash }: { hash: string }) {
  const data = useRemote((signal) => api.status(signal), []);
  const b = data.value?.backup;
  // Historical failures remain in the log; a later receipt for the same command replaces the alert.
  const latest = new Map<BackupCommand, BackupEvent>();
  for (const e of b?.events || []) if (!latest.has(e.command)) latest.set(e.command, e);
  const points = (b?.events || []).filter(
    (e) =>
      e.state === 'SUCCEEDED' && e.snapshot && ['CREATE', 'VERIFY', 'RESTORE', 'REPACK'].includes(e.command),
  );
  const attention =
    data.error ||
    (b &&
      (b.state !== 'FRESH' ||
        !b.events.length ||
        [...latest.values()].some((e) => e.state === 'FAILED' || e.state === 'UNKNOWN') ||
        (points.length > 0 && points.every((e) => Date.parse(e.snapshot!.expiresAt) <= Date.now()))));
  if (!attention) return null;
  return (
    <p className="storage-alert">
      <a href={adminHref('platform', 'engine', hash, { detail: 'storage' })}>
        存储与备份：
        {data.error ? '状态暂不可读' : b && b.state === 'NOT_CONFIGURED' ? '监测未接入' : '有状态需核对'} →
      </a>
    </p>
  );
}
function BackupFacts({ backup }: { backup: BackupObservation }) {
  const successes = backup.events.filter((e) => e.state === 'SUCCEEDED');
  const latest = (cmd: BackupCommand) => successes.find((e) => e.command === cmd);
  const points = new Map<string, BackupEvent>();
  for (const e of successes)
    if (
      e.snapshot &&
      ['CREATE', 'VERIFY', 'RESTORE', 'REPACK'].includes(e.command) &&
      !points.has(e.snapshot.id)
    )
      points.set(e.snapshot.id, e);
  return (
    <>
      <section className="admin-section storage-section" aria-label="备份与恢复验证">
        <div className="storage-heading">
          <h2>
            <ShieldCheck size={20} />
            备份与恢复验证
          </h2>
          <Badge>
            {
              { FRESH: '最近有记录', STALE: '记录过期', NOT_CONFIGURED: '未接入', UNAVAILABLE: '不可读取' }[
                backup.state
              ]
            }
          </Badge>
        </div>
        <p className="admin-note">
          {observationNote(backup)} 最近记录：{time(backup.updatedAt)}
        </p>
        <dl className="storage-facts">
          {(['CREATE', 'VERIFY', 'RESTORE', 'RECONCILE', 'ACTIVATE'] as const).map((cmd) => (
            <div key={cmd}>
              <dt>{commands[cmd]} · 最近成功记录</dt>
              <dd>{time(latest(cmd)?.finishedAt ?? null)}</dd>
              <small>{latest(cmd) ? descriptions[cmd] : '尚无成功记录，不推断已完成。'}</small>
            </div>
          ))}
        </dl>
        <p className="admin-note">
          下次备份时间、部署频率与保留策略：尚未接入。记录最多保留 40 条，不代表全部备份；备份总占用未知。
        </p>
      </section>
      <section className="admin-section storage-section" aria-label="已记录恢复点">
        <h2>
          <Archive size={20} />
          已记录恢复点
        </h2>
        <p className="admin-note">
          覆盖备份工具清单中的数据库与原文件。具体适配范围仍需部署核对，不能据此承诺全部业务已覆盖。可用性以重新校验为准。
        </p>
        {!points.size ? (
          <p className="admin-note">暂无恢复点监测信息。</p>
        ) : (
          <div className="storage-points">
            {[...points.values()].map((e) => {
              const p = e.snapshot!;
              return (
                <article key={p.id}>
                  <div className="storage-heading">
                    <strong>恢复点 · {p.id.slice(0, 8)}</strong>
                    <Badge>
                      {Date.parse(p.expiresAt) <= Date.now() ? '已过有效期' : '有效期内 · 可用性待核对'}
                    </Badge>
                  </div>
                  <dl>
                    <div>
                      <dt>备份时间</dt>
                      <dd>{time(p.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>有效期至</dt>
                      <dd>{time(p.expiresAt)}</dd>
                    </div>
                    <div>
                      <dt>清单覆盖</dt>
                      <dd>
                        {p.tables} 张表 · {p.files} 个文件（含数据库归档）
                      </dd>
                    </div>
                    <div>
                      <dt>清单登记大小</dt>
                      <dd>{bytes(p.bytes)}</dd>
                    </div>
                    <div>
                      <dt>最近成功步骤</dt>
                      <dd>
                        {commands[e.command]} · {time(e.finishedAt)}
                      </dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <section className="admin-section storage-section" aria-label="部署操作记录">
        <h2>部署操作记录</h2>
        <p className="admin-note">
          显示执行阶段和结果；详细排查在部署环境完成。恢复操作、位置及凭据由现场管理。
        </p>
        {!backup.events.length ? (
          <p className="admin-note">暂无操作记录。</p>
        ) : (
          <ol className="storage-events">
            {backup.events.map((e) => (
              <li key={e.id}>
                <div className="storage-heading">
                  <strong>{commands[e.command]}</strong>
                  <Badge>{stateNames[e.state]}</Badge>
                </div>
                <p>
                  {time(e.startedAt)}
                  {e.finishedAt ? ` → ${time(e.finishedAt)}` : ' · 未取得最终回执'}
                </p>
                <small>
                  {e.state === 'SUCCEEDED'
                    ? descriptions[e.command]
                    : e.state === 'FAILED'
                      ? '命令未完成，请在部署环境核对原因。'
                      : e.state === 'UNKNOWN'
                        ? '结果不完整或长时间未取得回执，不能认定已完成。'
                        : '已开始执行，等待最终回执。'}
                </small>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
function Facts({ value: v }: { value: StorageStatus }) {
  const [retentionOpen, setRetentionOpen] = useState(false);
  const s = v.storage,
    volume = s.originalVolume;
  return (
    <>
      <section className="admin-section storage-section" aria-label="存储用量">
        <div className="storage-heading">
          <h2>
            <HardDrive size={20} />
            存储用量
          </h2>
          <small>读取时间：{time(v.checkedAt)}</small>
        </div>
        <dl className="storage-metrics">
          <div>
            <dt>数据库占用</dt>
            <dd>{bytes(s.databaseBytes)}</dd>
            <small>包含表、索引及内部空间</small>
          </div>
          <div>
            <dt>知识内容及索引</dt>
            <dd>{bytes(s.knowledgeBytes)}</dd>
            <small>已包含在数据库占用中</small>
          </div>
          <div>
            <dt>原文件登记量</dt>
            <dd>{bytes(s.registeredOriginalBytes)}</dd>
            <small>排除已登记物理删除的文件，不等于磁盘实测</small>
          </div>
          <div>
            <dt>备份总占用</dt>
            <dd>未知</dd>
            <small>尚未接入全部备份的容量观测</small>
          </div>
        </dl>
        <div className="storage-volume">
          <div className="storage-heading">
            <strong>原文件所在存储卷</strong>
            <span>
              {volume.state === 'OBSERVED'
                ? `可用 ${bytes(volume.usableBytes)} / 总量 ${bytes(volume.totalBytes)}`
                : volume.state === 'NOT_CONFIGURED'
                  ? '未配置 · 容量未知'
                  : '不可读取 · 容量未知'}
            </span>
          </div>
          {volume.state === 'OBSERVED' && volume.totalBytes! > 0 && (
            <meter
              aria-label="原文件存储卷已用比例"
              min={0}
              max={volume.totalBytes!}
              value={volume.totalBytes! - volume.usableBytes!}
            />
          )}
          <small>存储卷可能包含其他应用文件，与上方业务登记量口径不同。</small>
        </div>
      </section>
      <BackupFacts backup={v.backup} />
      <details
        className="admin-section storage-section"
        onToggle={(e) => setRetentionOpen(e.currentTarget.open)}
      >
        <summary>查看任务通知清理</summary>
        {retentionOpen && <OperationRetentionStatus />}
      </details>
      <section className="admin-section storage-section" aria-label="资料清理状态">
        <h2>
          <Database size={20} />
          资料清理状态
        </h2>
        <dl className="storage-metrics">
          {[
            ['排队中', v.cleanup.queued],
            ['清理中', v.cleanup.running],
            ['未完成', v.cleanup.failed],
            ['累计完成', v.cleanup.completed],
          ].map(([label, n]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{Number(n).toLocaleString('zh-CN')}</dd>
            </div>
          ))}
        </dl>
        <p className="admin-note">
          最近完成：{time(v.cleanup.lastCompletedAt)}。仅统计资料清理任务，不代表备份轮转或所有系统数据清理。
        </p>
      </section>
    </>
  );
}
export function PlatformStorage({ hash }: { hash: string }) {
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((n) => n + 1);
  const data = useRemote((signal) => api.status(signal), [attempt]);
  return (
    <div className="storage-page">
      <a className="button ghost" href={adminHref('platform', 'engine', hash)}>
        <ArrowLeft size={16} />
        返回系统运行
      </a>
      <div className="storage-heading">
        <div>
          <h2>存储与备份</h2>
          <p className="admin-note">查看用量、备份事实与恢复验证进度。</p>
        </div>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新
        </Button>
      </div>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : data.value ? (
        <Facts value={data.value} />
      ) : (
        <Loading />
      )}
    </div>
  );
}
