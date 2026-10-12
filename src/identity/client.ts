import { supportPath, supportRoute } from './support-request.ts';
import type {
  Identity,
  Membership,
  TenantContext,
  Csrf,
  AcceptInvitation,
} from '../../contracts/public-api/identity.ts';

export class IdentityError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 0) {
    const messages: Record<string, string> = {
      PRESENTATION_UNAVAILABLE: 'PPT 生成环境尚未开放，请稍后再试。',
      PRESENTATION_CONFIRMATION_REQUIRED: '请先在大纲卡片中确认内容，再继续生成 PPT。',
      PRESENTATION_OPTIONS_MISMATCH: '生成的大纲与页数或风格设置不一致，请重试。',
      GOVERNANCE_PROPOSAL_CHANGED: '来源、维护记录或提案状态已变化，请刷新后重新核对。',
      WIKI_NO_CANDIDATES: '暂无可分析的有效共享知识，请先学习并发布。',
      WIKI_REVISION_CONFLICT: '知识已被更新，请刷新后核对最新版本再操作。',
      WIKI_SOURCE_CHANGED: '知识、资料版本或解析批次已变化，请刷新后重新学习或分析。',
      WIKI_SOURCE_NOT_READY: '尚无可学习的解析片段，请先完成资料解析。',
      WIKI_LEARNING_BUSY: '已有等待、进行中或待核对的 Wiki 任务，请查看学习草稿或知识关系中的原任务。',
      WIKI_RESULT_INVALID: 'Wiki 结果未通过范围或引用依据检查，请核对来源后重新发起。',
      SUPPORT_ACCESS_EXPIRED: '总部访问已失效，请返回总台重新进入。',
      SUPPORT_SCOPE_DENIED: '此操作不属于当前总部访问范围。负责人交接须通过专门流程。',
      CONVERSATION_BUSY: '会话正在执行，请选择停止并删除。',
      CONVERSATION_STATE_CHANGED: '会话状态已变化，请刷新后重试。',
      PHONE_INVALID: '请输入正确的手机号；海外号码请带国家区号。',
      PHONE_IN_USE: '此手机号已关联其他账号，请使用原账号登录或联系管理员核实。',
      PHONE_ALREADY_BOUND: '账号已绑定手机号，请重新登录。',
      PHONE_VERIFICATION_REQUIRED: '请先完成手机号验证。',
      SMS_UNAVAILABLE: '短信服务尚未配置，请联系管理员。',
      SMS_COOLDOWN: '请稍候再获取验证码。',
      SMS_THROTTLED: '验证码请求较多，请稍后再试。',
      CODE_INVALID: '验证码不正确或已过期，请检查后重试。',
      CODE_ATTEMPTS_EXCEEDED: '验证码尝试次数已用完，请重新获取。',
      CODE_UNAVAILABLE: '本地测试短信不可读取，请重新获取验证码。',
      LOCAL_PREVIEW_DISABLED: '当前环境没有启用本地测试短信。',
      SPACE_OWNER_USE_MANAGEMENT: '请在空间管理中明确更换负责人及原负责人的后续权限，然后继续离职办理。',
      SPACE_OWNER_CHANGE_REQUIRED: '请先更换空间负责人，再调整原负责人的权限。',
      LAST_PLATFORM_ADMIN: '必须保留至少一位有效的平台管理员。',
      PLATFORM_ALREADY_ADMIN: '该账号已经具备平台管理资格。',
      INVITATION_ALREADY_PENDING: '该手机号已有待接受邀请，请先查看邀请记录。',
      PLATFORM_INVITE_CREDENTIALS: '请使用受邀平台账号的密码，客户账号密码不能用于总台。',
      INVITATION_CONTEXT_LOST: '邀请上下文已失效，请重新打开原邀请链接。',
      LEGACY_INVITATION: '这是旧邮箱邀请，请联系管理员重新发送手机号邀请。',
      INVALID_CREDENTIALS: '账号或密码不正确，或账号已停用。',
      DEPARTURE_BUSINESS_STOPPED: '企业退出或成员离职已生效，当前不能开展新业务。',
      DEPARTURE_PRIVATE_ACCESS_STOPPED: '当前已进入退出或离职流程，私人会话、文稿和偏好已停止读取。',
      DEPARTURE_MEMBER_DISABLED: '正式离职已生效，当前企业内容已停止访问。',
      DEPARTURE_EXPORT_SCOPE_REQUIRED: '此内容不在你当前获准的退出导出范围，或导出期限已到。',
      DEPARTURE_REACTIVATION_BLOCKED: '存在正式离职或退出记录，不能通过普通启用操作恢复业务。',
      DOCUMENT_EXPORT_EXPIRED: '这个临时导出已过期；清理完成后可从仍可用的文稿重新生成。',
      AUTHENTICATION_REQUIRED: '登录已失效，请重新登录。',
      ACCESS_DENIED: '当前账号没有访问权限，或页面验证已过期，请刷新后重试。',
      LOGIN_THROTTLED: '尝试次数较多，请稍后再试。',
      CURRENT_PASSWORD_INCORRECT: '当前密码不正确。',
      PASSWORD_UNCHANGED: '新密码需要与当前密码不同。',
      EXPERIENCE_USE_UNCHANGED: '使用状态已经变化，请取消操作并核对当前状态。',
      COLLECTION_STATE_CHANGED: '取数设置已变化，请刷新后重新核对。',
      DATA_CONNECTION_NOT_FOUND: '接入不存在或当前没有查看权限。',
      DATASET_NOT_FOUND: '数据集不存在或当前没有查看权限。',
      DATASET_UNCONFIGURED: '尚未部署可更新的数据集。',
      CONNECTION_UNAVAILABLE: '连接当前不可用，请联系部署维护人员。',
      PASSWORD_POLICY: '密码需要 6–128 个字符。',
      INVALID_REQUEST: '请检查填写内容。',
      KNOWLEDGE_NOT_FOUND: '此来源不存在，或你已没有查看权限。',
      KNOWLEDGE_UNAVAILABLE: '本地解析尚未启用，请联系系统维护者。',
      KNOWLEDGE_GENERATION_CONFLICT: '解析状态已变化，请刷新此版本后重试。',
      LIBRARY_MOVE_SAME_LOCATION: '资料已在该目录，请选择其他目录。',
      LIBRARY_MOVE_CYCLE: '不能将文件夹移入自身或其子目录。',
      LIBRARY_MOVE_TOO_LARGE: '本次涉及的目录或人员过多，请缩小移动范围。',
      LIBRARY_MOVE_PREVIEW_STALE: '资料、成员或权限已有变化，请重新预览并核对后移动。',
      LIBRARY_MOVE_PERMISSION_MANAGER_REQUIRED: '此次移动涉及权限变化，需要空间管理员确认。',
      LIBRARY_AUDIT_UNAVAILABLE: '操作记录服务暂不可用，本次操作未执行，请稍后重试。',
      LIBRARY_PERMISSION_DENIED: '你没有此资料的操作权限。',
      LIBRARY_DOWNLOAD_DENIED: '此资料未授予下载权限，可继续在线查看。',
      LIBRARY_MANAGE_FILES_REQUIRED: '移动和删除需要管理员或明确委派资格。',
      LIBRARY_POLICY_PREVIEW_STALE: '成员、资料或权限已变化，请重新核对影响后保存。',
      LIBRARY_POLICY_PREVIEW_TOO_LARGE: '本次涉及的人员与资料过多，请联系管理员拆分授权范围。',
      LIBRARY_POLICY_CONFLICT: '权限或部门成员已被其他人修改，请重新打开并核对。',
      LIBRARY_SELF_GRANT_REQUIRES_REVIEW: '不能通过此操作增加你自己的内容权限，请由其他获权管理员处理。',
      LIBRARY_PERMISSION_ROLLOUT_REQUIRED: '此企业尚未启用新版资料权限。',
      MATERIAL_READ_ONLY: '此空间为只读，请联系企业管理员授予资料维护权限。',
      DOCUMENT_PUBLISH_TARGET_INVALID: '请选择获准维护的企业共享空间。',
      DOCUMENT_NOT_FOUND: '文稿不存在，或你已失去文稿及来源的访问权限。',
      DOCUMENT_SOURCE_UNSUPPORTED: '这个成果暂不支持网页编辑，请下载原文件处理。',
      DOCUMENT_REVISION_CONFLICT: '文稿已有新版本。请保留当前草稿，核对最新内容后再保存。',
      DOCUMENT_EXPORT_GLYPH_UNSUPPORTED:
        'PDF 字体暂不支持文稿中的部分字符。请改用 Word 导出，或调整字符后重试。',
      DOCUMENT_EXPORT_LIMIT: '文稿超过当前导出页数或文件大小限制，请拆分后重试。',
      DOCUMENT_EXPORT_BUSY: '导出任务较多，请稍后重试。',
      DOCUMENT_EXPORT_UNAVAILABLE: '文稿导出暂未完成，已保存的内容仍保留，请稍后重试。',
      RECOMMENDATION_CHANGED: '推荐设置已更新，请刷新后再确认。',
      RECOMMENDATION_SNAPSHOT_CHANGED: '推荐内容、权限或方法已变化，请刷新后继续查看。',
      DELIVERY_NOT_FOUND: '此成果已不可访问，请刷新。',
      DELIVERY_VERSION_CHANGED: '成果版本已变化，请刷新并核对最新内容。',
      BRIEFING_DAILY_QUOTA_EXCEEDED: '今日可用生成次数不足，请减少数量或等待额度恢复。',
      BRIEFING_REQUEST_CONFLICT: '本次生成请求已确认，请刷新后重新选择。',
      BRIEFING_NOT_FOUND: '画报来源已不可访问，请刷新。',
      BRIEFING_REVISION_CONFLICT: '画报设置已有更新，请刷新后重试。',
      BRIEFING_LAYOUT_CHANGED: '关注布局已被修改，请刷新后重新选择移动位置。',
      MATERIAL_NOT_FOUND: '资料或文件夹不存在，或已无法访问。',
      MATERIAL_LOCATION_UNAVAILABLE: '此空间不存在或你已没有访问权限。',
      MATERIAL_NAME_INVALID: '名称需为 1–180 个字符，不能含路径分隔符或控制字符。',
      TASK_ORIGINAL_UNAVAILABLE: '所选文件版本已不可访问，请重新选择。',
      TASK_ORIGINAL_TOO_LARGE: '单份原件上限 256 KiB，合计上限 512 KiB，请选择较小文件。',
      TASK_ORIGINALS_DISABLED: '当前任务环境尚未开放原件处理。',
      MATERIAL_TOO_LARGE: '文件超过本环境的上传上限，请选择较小文件。',
      MATERIAL_GOVERNANCE_VERSION_CONFLICT: '文件版本或检查记录已经变化，请重新核对后再处理。',
      MATERIAL_GOVERNANCE_TEXT_LIMIT: '检查文本超过本批 200 万字节或字符的处理范围，请拆分资料后重试。',
      MATERIAL_GOVERNANCE_UTF8_REQUIRED: '该文本不是有效 UTF-8 编码，请先转换编码并上传新版本。',
      MATERIAL_GOVERNANCE_REDACTION_TEXT_ONLY:
        '自动脱敏仅支持 UTF-8 TXT 或 Markdown 原件；其他格式请修订原件后上传新版本。',
      MATERIAL_GOVERNANCE_NO_SENSITIVE_MATCH: '当前版本没有可替换的敏感格式，不会生成重复版本。',
      MATERIAL_TEXT_UNSUPPORTED:
        '该资料不支持在线正文编辑，请上传新版本。仅支持 256 KB 内的 UTF-8 TXT 或 Markdown。',
      MATERIAL_VERSION_CONFLICT: '已有更新的版本。请关闭详情并刷新，核对最新版本后再上传。',
      MATERIAL_FOLDER_DEPTH: '文件夹层级已达到本环境上限。',
      MATERIAL_STORAGE_UNAVAILABLE: '原件存储暂不可用，请稍后重试。',
      MATERIAL_UPLOAD_FAILED: '文件传输未完成，请保持原文件重试。',
      WORKSPACE_GRANT_NOT_FOUND: '请先为该成员授予空间访问权限。',
      INVITATION_INVALID: '邀请码格式不正确，请检查后重试。',
      INVITATION_UNAVAILABLE: '邀请已过期、已撤销或已被接受，请联系邀请人。',
      INVITATION_ACCOUNT_LOGIN_REQUIRED: '请先使用受邀账号登录，再接受邀请。',
      INVITATION_ACCOUNT_MISMATCH: '当前账号与邀请不匹配，请切换到受邀账号。',
      EXISTING_ACCOUNT_CREDENTIALS_NOT_ALLOWED: '已有账号无需再次设置姓名和密码。',
      INVITATION_DELIVERY_UNAVAILABLE: '邀请服务暂时不可用，操作未完成，请稍后重试。',
      TENANT_NOT_FOUND: '企业不存在或已无法访问。',
      TENANT_SUSPENDED: '企业已停用，请恢复使用后再生成邀请。',
      STALE_TENANT_VERSION: '企业状态已被其他操作更新，请刷新详情后重新确认。',
      INITIAL_ADMIN_ALREADY_SET: '初始管理员已加入，不能再通过初始邀请更换管理员。',
      INITIAL_ADMIN_UNAVAILABLE: '无法取得初始管理员邀请，请联系平台维护者。',
      IDEMPOTENCY_CONFLICT: '本次请求内容与先前提交不一致，请刷新核对。',
      STALE_MANAGEMENT_VERSION: '信息已被其他操作更新，请关闭弹窗并刷新后重试。',
      LAST_TENANT_ADMIN: '必须保留至少一名有效的企业管理员。',
      MEMBER_NOT_FOUND: '该成员不存在或不属于当前企业。',
      WORKSPACE_ARCHIVED: '空间已归档，请先恢复后再修改。',
      WORKSPACE_ARCHIVE_DEPENDENCIES: '空间仍有业务关联记录，不能归档；请刷新核对。',
      DATASET_LIFECYCLE_CONFLICT: '数据集状态已变化，请刷新后重新确认。',
      WORKSPACE_NOT_FOUND: '共享空间不存在或不属于当前企业。',
      MEMBER_INACTIVE: '成员或账号已停用，暂不能新增授权。',
      SELF_GRANT_NOT_ENABLED: '配置管理员不能为自己新增内容权限，请由企业授权负责人明确授权。',
      OWNER_REQUIRED_FOR_ADMIN_GRANT: '向管理人员授予内容权限需要企业授权负责人操作。',
      OWNER_HANDOVER_REQUIRED: '普通停用或撤销职责前须先完成负责人交接；存在安全风险时可使用紧急安全停用。',
      SECURITY_RECOVERY_PENDING: '此成员涉及待核验的安全恢复，普通恢复不能绕过核验。',
      GOVERNANCE_VERSION_CONFLICT: '职责已有更新，请刷新后重新确认。',
      IDENTITY_ALREADY_UNIFIED: '这两个入口已属于同一账号，无需关联。',
      IDENTITY_LINK_REQUIRES_REVIEW: '账号存在其他身份或关联冲突，需要受控核验后处理。',
      PLATFORM_LOGIN_OCCUPIED: '该总台专用账号已被占用，请更换。',
      OWNER_ACCEPTANCE_REQUIRED: '企业需要初始负责人明确接受后才能开通。',
      OWNER_DESIGNATION_REQUIRED: '当前账号没有可接受的负责人指定。',
      CAPABILITY_REQUIRED: '当前没有执行此动作所需的范围能力。',
      HANDOVER_UNAVAILABLE: '交接状态或原负责人资格已变化，请重新核实。',
      HANDOVER_NOT_FOUND: '没有可由你处理的交接请求。',
      HANDOVER_ALREADY_PENDING: '已有交接等待处理，请先撤销当前交接再选择其他接任者。',
      COMPANY_INFERENCE_UNAVAILABLE: '这条建议的依据或状态已变化，请刷新后查看。',
      COMPANY_SUGGESTION_NOT_FOUND: '这条更新建议已不可用。',
      COMPANY_EVIDENCE_INVALID: '建议依据未通过核验。',
      COMPANY_TAG_LIMIT: '此项已达到标签数量上限，请调整已有标签。',
      PROFILE_MANAGED_COMPANY_INFORMATION: '请在企业信息页调整此标签。',
      PROFILE_READ_ONLY: '当前档案范围为只读。',
      PROFILE_NOT_FOUND: '档案不存在或你已没有访问权限。',
      PROFILE_KEY_EXISTS: '此范围已有同名档案，请修订已有记录。',
      PROFILE_VERSION_CONFLICT: '档案已有新版本，请保留草稿，关闭编辑并刷新后核对。',
      PROFILE_VERSION_NOT_FOUND: '此档案版本不存在或无法访问。',
      STATE_CONFLICT: '当前状态已发生变化，请刷新确认。',
      CONTRACT_MISMATCH: '服务返回的信息暂时无法读取，请稍后重试。',
      UNAVAILABLE: '暂时无法连接服务，请稍后重试。',
      UNCERTAIN_RESULT: '连接中断，操作结果尚未确认。请刷新确认后再试。',
      CANCELLED: '请求已取消。',
    };
    super(messages[code] || '请求未完成，请稍后重试。');
    this.name = 'IdentityError';
    this.code = code;
    this.status = status;
  }
}
export const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const role = (v: unknown) => v === 'TENANT_ADMIN' || v === 'MEMBER';
export const isContact = (v: Record<string, unknown>) =>
  (v.phone == null || (typeof v.phone === 'string' && /^\+[1-9][0-9]{7,14}$/.test(v.phone))) &&
  (v.email == null || text(v.email)) &&
  (text(v.phone) || text(v.email));
export const contactLabel = (v: { phone?: string | null; email?: string | null }) =>
  v.phone || v.email || '未绑定手机号';
export function isMembership(v: unknown): v is Membership {
  return (
    record(v) &&
    uuid(v.tenantId) &&
    text(v.tenantName) &&
    role(v.role) &&
    (v.service === undefined ||
      (record(v.service) &&
        ['ACTIVE', 'SUSPENDED'].includes(String(v.service.status)) &&
        (v.service.explanation === null || typeof v.service.explanation === 'string') &&
        (v.service.changedAt === null ||
          (typeof v.service.changedAt === 'string' && Number.isFinite(Date.parse(v.service.changedAt))))))
  );
}
export function isIdentity(v: unknown): v is Identity {
  return (
    record(v) &&
    record(v.account) &&
    uuid(v.account.id) &&
    isContact(v.account) &&
    text(v.account.displayName) &&
    typeof v.platformAdmin === 'boolean' &&
    Array.isArray(v.memberships) &&
    v.memberships.every(isMembership) &&
    new Set(v.memberships.map((m) => m.tenantId)).size === v.memberships.length
  );
}
export function isTenantContext(v: unknown): v is TenantContext {
  return (
    record(v) &&
    record(v.tenant) &&
    uuid(v.tenant.id) &&
    text(v.tenant.name) &&
    (v.tenant.status === 'ACTIVE' || (supportRoute() !== null && v.tenant.status === 'SUSPENDED')) &&
    role(v.role) &&
    Array.isArray(v.workspaces) &&
    v.workspaces.every(
      (w) => record(w) && uuid(w.id) && text(w.name) && ['PERSONAL', 'SHARED'].includes(String(w.kind)),
    ) &&
    new Set(v.workspaces.map((w) => w.id)).size === v.workspaces.length
  );
}
const isCsrf = (v: unknown): v is Csrf => record(v) && text(v.token) && v.headerName === 'X-CSRF-TOKEN';

export function createIdentityRequest(fetcher: typeof fetch = fetch, timeoutMs = 10_000) {
  async function request<T>(
    path: string,
    method: string,
    validate: (v: unknown) => v is T,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    path = supportPath(path);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, timeoutMs);
    let sent = false;
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (method !== 'GET') {
        const token = await request(
          path.startsWith('/api/platform-admin/') ? '/api/platform-admin/v1/auth/csrf' : '/api/v1/auth/csrf',
          'GET',
          isCsrf,
          undefined,
          controller.signal,
        );
        headers[token.headerName] = token.token;
        if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
      }
      sent = true;
      const response = await fetcher(path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers,
        signal: controller.signal,
        ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const fallback =
          response.status === 401
            ? 'AUTHENTICATION_REQUIRED'
            : response.status === 403
              ? 'ACCESS_DENIED'
              : 'UNAVAILABLE';
        throw new IdentityError(
          record(payload) && payload.contractVersion === '1.0' && typeof payload.code === 'string'
            ? payload.code
            : fallback,
          response.status,
        );
      }
      const payload: unknown = response.status === 204 ? null : await response.json().catch(() => undefined);
      if (!validate(payload)) throw new IdentityError('CONTRACT_MISMATCH');
      return payload;
    } catch (error) {
      if (signal?.aborted) throw new IdentityError('CANCELLED');
      if (error instanceof IdentityError) throw error;
      throw new IdentityError(method !== 'GET' && sent ? 'UNCERTAIN_RESULT' : 'UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
  return request;
}

export function createIdentityClient(fetcher: typeof fetch = fetch, timeoutMs = 10_000) {
  const request = createIdentityRequest(fetcher, timeoutMs);
  return {
    me: (signal?: AbortSignal) => request('/api/v1/me', 'GET', isIdentity, undefined, signal),
    login: (phone: string, password: string) =>
      request('/api/v1/auth/login', 'POST', isIdentity, { phone, password }),
    legacyLogin: (email: string, password: string) =>
      request('/api/v1/auth/login', 'POST', isIdentity, { email, password }),
    logout: () => request('/api/v1/auth/logout', 'POST', (v): v is null => v === null),
    accept: (body: AcceptInvitation) =>
      request('/api/v1/auth/invitations/accept', 'POST', isMembership, body),
    async context(tenant: string, signal?: AbortSignal) {
      if (!uuid(tenant)) throw new IdentityError('ACCESS_DENIED', 403);
      const result = await request(
        `/api/v1/tenants/${tenant}/context`,
        'GET',
        isTenantContext,
        undefined,
        signal,
      );
      if (result.tenant.id !== tenant) throw new IdentityError('CONTRACT_MISMATCH');
      return result;
    },
  };
}
export type IdentityClient = ReturnType<typeof createIdentityClient>;
