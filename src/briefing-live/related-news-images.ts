/** Curated search result for an existing article; never a source of business evidence.
 * No title-keyword guessing or runtime image-generation fallback.
 */
export const relatedNewsImages: Record<
  string,
  {
    src: string;
    alt: string;
    sourceUrl: string;
    author: string;
    license: string;
    licenseUrl: string;
    caption: string;
  }
> = {
  '户外运动需求扩大，先试体能服务再扩品类': {
    src: '/images/news/mountain-hiking.jpg',
    alt: '山地户外景观：绿色山坡、步道与远山，相关主题实拍照片',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Landscape-mountains-nature-hiking_(24300577396).jpg',
    author: 'Pixel.la Free Stock Photos',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    caption: '相关配图 · 山地户外景观 · 非原文配图、非新闻现场',
  },
};

// Verified real landscape reused as an explicitly related image for the new safety article.
relatedNewsImages['户外赛事引入北斗，先核查活动安全准备'] = relatedNewsImages['户外运动需求扩大，先试体能服务再扩品类'];

// Industry pilot: related outdoor landscape, not a film still or reported event photograph.
relatedNewsImages['影视话题能否带动运动需求？先小范围验证'] = relatedNewsImages['户外运动需求扩大，先试体能服务再扩品类'];
