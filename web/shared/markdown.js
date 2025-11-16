/**
 * 轻量级Markdown解析器
 * 支持基本的Markdown语法,无需外部依赖
 */

export function parseMarkdown(markdown) {
  if (!markdown) return '';
  
  let html = markdown
    // 转义HTML特殊字符
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    
    // 标题 (### ## #)
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    
    // 粗体 **text**
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    
    // 斜体 *text*
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    
    // 行内代码 `code`
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    
    // 链接 [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    
    // 无序列表
    .replace(/^\* (.+)$/gim, '<li>$1</li>')
    
    // 段落和换行
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  
  // 包裹列表
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  
  // 包裹段落
  if (!html.startsWith('<h') && !html.startsWith('<ul')) {
    html = '<p>' + html + '</p>';
  }
  
  return html;
}

export function escapeMarkdown(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/`/g, '\\`');
}
