import { useEffect, useRef } from 'react';

/**
 * 引擎舞台的星云背景，单独拿出来用。着色器取自 engine-stage/scene.ts 里合成阶段的背景部分
 *（同样的噪声、色彩和缓慢漂移），去掉了核心、光流和辉光。
 */
const VS = `#version 300 es
out vec2 vU;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vU=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
const FS = `#version 300 es
precision mediump float;in vec2 vU;uniform float uTime;uniform vec2 uR;uniform vec2 uC;out vec4 o;
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=fract(sin(dot(i,vec2(127.1,311.7)))*43758.5),b=fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.5),c=fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.5),d=fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.5);return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n2(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
void main(){vec3 c=vec3(0.);
 vec2 ar=vec2(uR.x/uR.y,1.);vec2 p=vU*ar*2.2;
 float lift=1.-smoothstep(.0,1.25,length((vU-vec2(.5,.52))*ar));vec3 bg=vec3(.034,.03,.026)+vec3(.05,.042,.032)*lift;
 float neb=fbm(p+vec2(uTime*.012,-uTime*.007)+fbm(p*.6-uTime*.01)*1.4);neb=smoothstep(.3,.95,neb);
 bg+=mix(vec3(.11,.085,.06),vec3(.045,.065,.13),smoothstep(.2,.9,vU.x+(vU.y-.5)*.4))*neb*1.3;
 float cg=1.-smoothstep(0.,.62,length((vU-uC)*ar));bg+=vec3(.07,.052,.032)*cg*cg;
 c+=bg;c=vec3(1.)-exp(-c*1.25);
 vec2 q=vU-.5;q.x*=uR.x/uR.y;c*=1.-smoothstep(.5,1.25,length(q))*.6;
 o=vec4(c,1.);}`;

export function Nebula({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const on = useRef(active);
  on.current = active;
  useEffect(() => {
    const canvas = ref.current!;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) return;
    const shader = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    gl.bindVertexArray(gl.createVertexArray());
    const uTime = gl.getUniformLocation(program, 'uTime'),
      uR = gl.getUniformLocation(program, 'uR'),
      uC = gl.getUniformLocation(program, 'uC');
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const size = () => {
      // 星云很柔，半分辨率足够，省电。
      canvas.width = Math.max(1, Math.round(canvas.clientWidth / 2));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight / 2));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const observer = new ResizeObserver(size);
    observer.observe(canvas);
    size();
    const t0 = performance.now();
    let raf = 0,
      drawn = false;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if ((!on.current || still) && drawn) return;
      drawn = true;
      gl.uniform1f(uTime, still ? 20 : (now - t0) / 1000 + 20);
      gl.uniform2f(uR, canvas.width, canvas.height);
      gl.uniform2f(uC, 0.5, 0.52);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);
  return <canvas ref={ref} className="nebula" aria-hidden="true" />;
}
