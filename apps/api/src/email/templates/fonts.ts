const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap';

export function getFontFaceCSS(): string {
  return `<!--[if !mso]>--><link href="${FONTS_URL}" rel="stylesheet" type="text/css" /><!--<![endif]-->`;
}
