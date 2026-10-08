import { Color } from "three"

/**
 * 扩散波着色器：在材质片元里按到原点的距离画一圈向外扩散的亮环
 * 通过 onBeforeCompile 注入，uTime 由外部（gsap）驱动
 */
export class DiffuseShader {
  constructor({
    material,
    time,
    size,
    diffuseColor,
    diffuseSpeed,
    diffuseWidth,
    callback = () => {}
  }) {
    this.time = time
    this.pointShader = null
    this.callback = callback
    const defaultOptions = {
      size: 100,
      diffuseSpeed: 15.0,
      diffuseColor: 0x8e9b9e,
      diffuseWidth: 10.0
    }
    this.options = Object.assign({}, defaultOptions, {
      material,
      size,
      diffuseColor,
      diffuseSpeed,
      diffuseWidth
    })
    this.init()
  }
  init() {
    const { material, size, diffuseColor, diffuseSpeed, diffuseWidth } =
      this.options
    const maxTime = size / diffuseSpeed

    material.onBeforeCompile = (shader) => {
      this.pointShader = shader
      this.callback(shader, maxTime)
      shader.uniforms = {
        ...shader.uniforms,
        uTime: { value: 0.0 },
        uSpeed: { value: diffuseSpeed },
        uWidth: { value: diffuseWidth },
        uColor: { value: new Color(diffuseColor) }
      }
      shader.vertexShader = shader.vertexShader.replace(
        "void main() {",
        /* glsl */ `
            varying vec3 vPosition;
            void main(){
              vPosition = position;
          `
      )
      shader.fragmentShader = shader.fragmentShader.replace(
        "void main() {",
        /* glsl */ `
            uniform float uTime;
            uniform float uSpeed;
            uniform float uWidth;
            uniform vec3 uColor;
            varying vec3 vPosition;
            void main(){
          `
      )
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        /* glsl */ `
            #ifdef OPAQUE
            diffuseColor.a = 1.0;
            #endif

            #ifdef USE_TRANSMISSION
            diffuseColor.a *= material.transmissionAlpha;
            #endif

            float r = uTime * uSpeed;
            float w = uWidth;
            vec2 center = vec2(0.0, 0.0);
            float rDistance = distance(vPosition.xy, center);

            if(rDistance > r && rDistance < r + 2.0 * w) {
              if(rDistance < r + w) {
                float p = smoothstep(0.0,1.0,(rDistance - r) / w);
                p*=p;
                outgoingLight = mix(outgoingLight, uColor, p);
              } else {
                float p = smoothstep(0.0,1.0,(rDistance - r - w) / w);
                outgoingLight = mix(uColor, outgoingLight, p);
              }
              gl_FragColor = vec4(outgoingLight, diffuseColor.a);
            } else {
              gl_FragColor = vec4(outgoingLight, 0.0);
            }
          `
      )
    }
  }
}
