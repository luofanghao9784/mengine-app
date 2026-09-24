export function DraftWarning({
  unavailable,
  unreadable,
  pending,
}: {
  unavailable: boolean;
  unreadable: boolean;
  pending: boolean;
}) {
  if (!unavailable && !unreadable) return null;
  return (
    <p className="access-alert" role="alert">
      {unreadable && '未能读取此前的本地草稿。'}
      {unavailable && '当前草稿尚未保存在浏览器中，请先复制保留；刷新、切换页面或关闭标签页可能丢失内容。'}
      {unavailable && pending && ' 本页可重试同一次请求；离开后请先核对已保存的记录，避免重复提交。'}
    </p>
  );
}
