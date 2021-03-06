/**
* Shader for render to texture
*/
precision mediump float;
precision mediump int;

uniform float xDim;
uniform float yDim;
uniform float zDim;

uniform sampler2D texBF;
uniform sampler2D texFF;
uniform sampler2D texVolume;
uniform sampler2D texVolumeMask;
uniform sampler2D texTF;
uniform float opacityBarrier;
uniform vec3 lightDir;
uniform float isoThreshold;
uniform float brightness3D;
uniform float contrast3D;
uniform vec4 t_function1min;
uniform vec4 t_function1max;
uniform vec4 t_function2min;
uniform vec4 t_function2max;
uniform vec4 stepSize;
uniform float texSize;
uniform float tileCountX;
uniform float volumeSizeZ;

varying vec4 screenpos;

vec4 tex3D(vec3 vecCur) {
  float tCX = 1.0 / tileCountX;
  vecCur = vecCur + vec3(0.5, 0.5, 0.5);
  // check outside of texture volume
  if ((vecCur.x < 0.0) || (vecCur.y < 0.0) || (vecCur.z < 0.0) || (vecCur.x > 1.0) ||  (vecCur.y > 1.0) || (vecCur.z > 1.0))
    return vec4(0.0, 0.0, 0.0, 0.0);
  float zSliceNumber1 = floor(vecCur.z  * (volumeSizeZ));
    float zRatio = (vecCur.z * (volumeSizeZ)) - zSliceNumber1;
  //zSliceNumber1 = min(zSliceNumber1, volumeSizeZ - 1.0);
  // As we use trilinear we go the next Z slice.
  float zSliceNumber2 = min( zSliceNumber1 + 1.0, (volumeSizeZ - 1.0)); //Clamp to 255
  vec2 texCoord = vecCur.xy;
  vec2 texCoordSlice1, texCoordSlice2;
  texCoordSlice1 = texCoordSlice2 = texCoord;

  // Add an offset to the original UV coordinates depending on the row and column number.
  texCoordSlice1.x += (mod(zSliceNumber1, tileCountX - 0.0 ));
  texCoordSlice1.y += floor(zSliceNumber1 / (tileCountX - 0.0) );
  // ratio mix between slices
  //float zRatio = mod(vecCur.z * (volumeSizeZ), 1.0);
  texCoordSlice2.x += (mod(zSliceNumber2, tileCountX - 0.0 ));
  texCoordSlice2.y += floor(zSliceNumber2 / (tileCountX - 0.0));

  // add 0.5 correction to texture coordinates
  float xSize = float(xDim);
  float ySize = float(yDim);
  vec2 vAdd = vec2(0.5 / xSize, 0.5 / ySize);
  texCoordSlice1 += vAdd;
  texCoordSlice2 += vAdd;

  // get colors from neighbour slices
  vec4 colorSlice1 = texture2D(texVolume, clamp(texCoordSlice1 * tCX, vec2(0.0, 0.0), vec2(1.0, 1.0)), 0.0);
  vec4 colorSlice2 = texture2D(texVolume, clamp(texCoordSlice2 * tCX, vec2(0.0, 0.0), vec2(1.0, 1.0)), 0.0);
  return mix(colorSlice1, colorSlice2, zRatio);
}
vec4 tex3DMask(vec3 vecCur) {
  float tCX = 1.0 / tileCountX;
  vecCur = vecCur + vec3(0.5, 0.5, 0.5);
  // check outside of texture volume
  if ((vecCur.x < 0.0) || (vecCur.y < 0.0) || (vecCur.z < 0.0) || (vecCur.x > 1.0) ||  (vecCur.y > 1.0) || (vecCur.z > 1.0))
    return vec4(0.0, 0.0, 0.0, 0.0);
  float zSliceNumber1 = floor(vecCur.z  * (volumeSizeZ));
    float zRatio = (vecCur.z * (volumeSizeZ)) - zSliceNumber1;
  //zSliceNumber1 = min(zSliceNumber1, volumeSizeZ - 1.0);
  // As we use trilinear we go the next Z slice.
  float zSliceNumber2 = min( zSliceNumber1 + 1.0, (volumeSizeZ - 1.0)); //Clamp to 255
  vec2 texCoord = vecCur.xy;
  vec2 texCoordSlice1, texCoordSlice2;
  texCoordSlice1 = texCoordSlice2 = texCoord;

  // Add an offset to the original UV coordinates depending on the row and column number.
  texCoordSlice1.x += (mod(zSliceNumber1, tileCountX - 0.0 ));
  texCoordSlice1.y += floor(zSliceNumber1 / (tileCountX - 0.0) );
  // ratio mix between slices
  //float zRatio = mod(vecCur.z * (volumeSizeZ), 1.0);
  texCoordSlice2.x += (mod(zSliceNumber2, tileCountX - 0.0 ));
  texCoordSlice2.y += floor(zSliceNumber2 / (tileCountX - 0.0));

  // add 0.5 correction to texture coordinates
  float xSize = float(xDim);
  float ySize = float(yDim);
  vec2 vAdd = vec2(0.5 / xSize, 0.5 / ySize);
  texCoordSlice1 += vAdd;
  texCoordSlice2 += vAdd;

  // get colors from neighbour slices
  vec4 colorSlice1 = texture2D(texVolumeMask, clamp(texCoordSlice1 * tCX, vec2(0.0, 0.0), vec2(1.0, 1.0)), 0.0);
  vec4 colorSlice2 = texture2D(texVolumeMask, clamp(texCoordSlice2 * tCX, vec2(0.0, 0.0), vec2(1.0, 1.0)), 0.0);
  return mix(colorSlice1, colorSlice2, zRatio);
}

/**
* Isosurface color calculation
*/
vec3 CalcLighting(vec3 iter, vec3 dir)
{
  const float AMBIENT = 0.3;
  const float DIFFUSE = 0.7;
  const float SPEC = 0.1;
  const float SPEC_POV = 90.0;

  float d = 1.0 / texSize;
  vec3 dx = vec3(d, 0.0, 0.0), dy = vec3(0.0, d, 0.0), dz = vec3(0.0, 0.0, d), N, sumCol = vec3(0.0);
  // Culculate normal
  float l, r;
  l = tex3D(iter - dx).a;
  r = tex3D(iter + dx).a;
  #if MaskFlag == 1
  {
    l = l * tex3DMask(iter - dx).a;
    r = r * tex3DMask(iter + dx).a;
  }
  #endif
  N.x = r - l;
  l = tex3D(iter - dy).a;
  r = tex3D(iter + dy).a;
  #if MaskFlag == 1
  {
    l = l * tex3DMask(iter - dy).a;
    r = r * tex3DMask(iter + dy).a;
  }
  #endif
  N.y = r - l;
  l = tex3D(iter - dz).a;
  r = tex3D(iter + dz).a;
  #if MaskFlag == 1
  {
    l = l * tex3DMask(iter - dz).a;
    r = r * tex3DMask(iter + dz).a;
  }
  #endif
  N.z = r - l;
  N = normalize(N);
  // Calculate the density of the material in the vicinity of the isosurface
  float dif = max(0.0, dot(N, -lightDir));
  sumCol = mix(t_function2min.rgb, t_function2max.rgb, 1.-dif);
  float specular = pow(max(0.0, dot(normalize(reflect(lightDir, N)), dir)), SPEC_POV);
  // The resulting color depends on the longevity of the material in the surface of the isosurface
  return  (0.5*(brightness3D + 1.5)*(DIFFUSE * dif + AMBIENT) + SPEC * specular) * sumCol;
}

/**
* Refinement of the coordinate of the isosurface
*/
vec3 Correction(vec3 left, vec3 right, float threshold) {
    vec3 iterator;
    float vol;
    for (int i = 0; i < 7; i++)
    {
        iterator = 0.5*(left + right);
        vol = tex3D(iterator).a;
        #if MaskFlag == 1
        {
          vol = vol * tex3DMask(iterator).a;
        }
        #endif
        if (vol > threshold)
            right = iterator;
        else
            left = iterator;
    }
    iterator = 0.5*(left + right);
    return iterator;
}

/**
* Refinement of the coordinate of the isosurface
*/
vec3 CorrectionZero(vec3 left, vec3 right) {
    vec3 iterator;
    float vol, valTF;
    for (int i = 0; i < 7; i++)
    {
        iterator = 0.5*(left + right);
        vol = tex3D(iterator).a;
        #if MaskFlag == 1
        {
          vol = vol * tex3DMask(iterator).a;
        }
        #endif
        valTF = texture2D(texTF, vec2(vol, 0.0), 0.0).a;
        if (valTF > 0.0)
            right = iterator;
        else
            left = iterator;
    }
    iterator = 0.5*(left + right);
    return iterator;
}

/**
* Calculation of normal
*/
vec3 CalcNormal(vec3 iter)
{
  float d = 1.0 / texSize;
  vec3 dx = vec3(d, 0.0, 0.0), dy = vec3(0.0, d, 0.0), dz = vec3(0.0, 0.0, d), N;
  // Culculate normal
  N.x = tex3D(iter + dx).a - tex3D(iter - dx).a;
  N.y = tex3D(iter + dy).a - tex3D(iter - dy).a;
  N.z = tex3D(iter + dz).a - tex3D(iter - dz).a;
  N = normalize(N);
  return N;
}

/**
* Direct volume render
*/
vec4 VolumeRender(vec3 start, vec3 dir, vec3 back) {
    const int MAX_I = 1000;
    const float BRIGHTNESS_SCALE = 5.0;
    vec3 iterator = start;
    vec4 acc = vec4(0.0, 0.0, 0.0, 2.0), vol;
    float StepSize = stepSize.r, alpha;
    vec3 step = StepSize*dir, color, sumCol = vec3(0.0, 0.0, 0.0), surfaceLighting = vec3(0.0, 0.0, 0.0);
    float sumAlpha = 0.0, t12 = 1.0 / (t_function1max.a - t_function1min.a), lighting;
    bool inFlag = false, oldInFlag = false;
    int count = int(floor(length(iterator - back) / StepSize));
    // Calc volume integral
    for (int i = 0; i < MAX_I; i++)
    {
        iterator = iterator + step;
        vol = tex3D(iterator);
        #if MaskFlag == 1
        {
          vol.a = vol.a * tex3DMask(iterator).a;
        }
        #endif
        if (count <= 0 || sumAlpha > 0.97 || vol.a > t_function2min.a)
            break;
        // In/Out flag
        oldInFlag = inFlag;
        inFlag = vol.a > t_function1min.a && vol.a <  t_function1max.a;
        if (inFlag || oldInFlag != inFlag)
        {
            // If the transfer function is nonzero, the integration step is halved
            // First step
            vec4 vol1 = tex3D(iterator - 0.5 * step);
            #if MaskFlag == 1
            {
              vol1.a = vol1.a * tex3DMask(iterator - 0.5 * step).a;
            }
            #endif
            // Transfer function - isosceles triangle
            alpha = min(vol1.a - t_function1min.a, t_function1max.a - vol1.a);
            alpha = opacityBarrier * max(0.0, alpha) * t12;
            color = mix(t_function1min.rgb, t_function1max.rgb, (vol1.a - t_function1min.a) * t12);
            lighting = 0.5 * max(0.0, dot(normalize(vol1.rgb - vec3(0.5, 0.5, 0.5)), -lightDir)) + 0.5;
            // Volume integral on the interval StepSize
            sumCol += (1. - sumAlpha)* alpha * StepSize * color * lighting;
            sumAlpha += (1. - sumAlpha) * alpha * StepSize;
            // Second step
            // Transfer function - isosceles triangle
            alpha = min(vol.a - t_function1min.a, t_function1max.a - vol.a);
            alpha = opacityBarrier*max(0.0, alpha) * t12;
            color = mix(t_function1min.rgb, t_function1max.rgb, (vol.a - t_function1min.a) * t12);
            lighting = 0.5 * max(0.0, dot(normalize(vol.rgb - vec3(0.5, 0.5, 0.5)), -lightDir)) + 0.5;
            // Volume integral on the interval StepSize
            sumCol += (1. - sumAlpha) * alpha * StepSize * color * lighting;
            sumAlpha += (1. - sumAlpha) * alpha * StepSize;
        }
        count--;
    } // for i
    // Calculate the color of the isosurface
    if (count > 0) {
        iterator = Correction(iterator - step, iterator, t_function2min.a);
        surfaceLighting = CalcLighting(iterator, dir);
    }
    acc.rgb = BRIGHTNESS_SCALE * brightness3D * sumCol + (1.0 - sumAlpha) * surfaceLighting;
    return acc;
}



/**
* ROI Direct volume render
*/
vec4 RoiVolumeRender(vec3 start, vec3 dir, vec3 back) {
    const int MAX_I = 1000;
    const float BRIGHTNESS_SCALE = 1.0;
    vec3 iterator = start;
    vec4 acc = vec4(0.0, 0.0, 0.0, 2.0), vol;
    float StepSize = stepSize.r, alpha;
    vec3 step = StepSize*dir, sumCol = vec3(0.0, 0.0, 0.0), surfaceLighting = vec3(0.0, 0.0, 0.0);
    vec3 color = vec3(1.0, 0.9, 0.8);
    float sumAlpha = 0.0, t12 = 1.0 / (t_function1max.a - t_function1min.a), lighting;
    bool inFlag = false, oldInFlag = false;
    int count = int(floor(length(iterator - back) / StepSize));
    // Calc volume integral
    for (int i = 0; i < MAX_I; i++)
    {
        iterator = iterator + step;
        vol = tex3D(iterator);
        if (count <= 0 || sumAlpha > 0.97 || vol.a > 0.75)
            break;
        // In/Out flag
        oldInFlag = inFlag;
        inFlag = vol.a > t_function1min.a && vol.a <  t_function1max.a;
        if (inFlag || oldInFlag != inFlag)
        {
            // If the transfer function is nonzero, the integration step is halved
            // First step
            vec4 vol1 = tex3D(iterator - 0.5 * step);
            // Transfer function - isosceles triangle
            alpha = min(vol1.a - t_function1min.a, t_function1max.a - vol1.a);
            alpha = opacityBarrier * max(0.0, alpha) * t12;
//            color = mix(t_function1min.rgb, t_function1max.rgb, (vol1.a - t_function1min.a) * t12);
            vec3 N = CalcNormal(iterator);
            lighting = 0.5 * max(0.0, dot(N, -lightDir)) + 0.5;
//            float dif = 1.0 - dot(N, dir);
            float t = 1.0 - max(0.0, dot(N, dir));
            float dif = pow(t, 4.0 * brightness3D);
            alpha = dif * alpha;
            // Volume integral on the interval StepSize
            sumCol += (1. - sumAlpha)* alpha * StepSize * color * lighting;
            sumAlpha += (1. - sumAlpha) * alpha * StepSize;
            // Second step
            // Transfer function - isosceles triangle
            alpha = min(vol.a - t_function1min.a, t_function1max.a - vol.a);
            alpha = opacityBarrier*max(0.0, alpha) * t12;
            alpha = dif * alpha;
 //           color = mix(t_function1min.rgb, t_function1max.rgb, (vol.a - t_function1min.a) * t12);
            // Volume integral on the interval StepSize
            sumCol += (1. - sumAlpha) * alpha * StepSize * color * lighting;
            sumAlpha += (1. - sumAlpha) * alpha * StepSize;
        }
        count--;
    } // for i
    // Calculate the color of the isosurface
    if (count > 0) {
        const float AMBIENT = 0.3;
        const float DIFFUSE = 0.7;
        const float SPEC = 0.1;
        const float SPEC_POV = 90.0;
        iterator = Correction(iterator - step, iterator, 0.75);
        vec3 N = CalcNormal(iterator);
        float dif = max(0.0, dot(N, -lightDir));
        float specular = pow(max(0.0, dot(normalize(reflect(lightDir, N)), dir)), SPEC_POV);
        // The resulting color depends on the longevity of the material in the surface of the isosurface
        surfaceLighting = (0.5*(brightness3D + 1.5)*(DIFFUSE * dif + AMBIENT) + SPEC * specular) * vol.rgb;
    }
//    acc.rgb = BRIGHTNESS_SCALE * brightness3D * sumCol + (1.0 - sumAlpha) * surfaceLighting;
    acc.rgb = BRIGHTNESS_SCALE * sumCol + (1.0 - sumAlpha) * surfaceLighting;
    return acc;
}


/**
* Full direct volume render
*/
vec4 FullVolumeRender(vec3 start, vec3 dir, vec3 back) {
    const int MAX_I = 1000;
    const float BRIGHTNESS_SCALE = 2.0;
    const float OPACITY_SCALE = 5.0;
    vec3 iterator = start;
    vec4 acc = vec4(0.0, 0.0, 0.0, 1.0), vol, valTF = vec4(0.0, 0.0, 0.0, 1.0);
    float StepSize = stepSize.r;
    vec3 step = StepSize*dir, sumCol = vec3(0.0, 0.0, 0.0);
    float sumAlpha = 0.0, lighting;
    int count = int(floor(length(iterator - back) / StepSize));
    float opacity = OPACITY_SCALE * opacityBarrier * StepSize;
    // Calc volume integral
    for (int i = 0; i < MAX_I; i++)
    {
        if (count <= 0 || sumAlpha > 0.97)
            break;
        iterator = iterator + step;
        vol = tex3D(iterator);
        #if MaskFlag == 1
        {
          vol.a = vol.a * tex3DMask(iterator).a;
        }
        #endif
        valTF = texture2D(texTF, vec2(vol.a, 0.0), 0.0);
        if (valTF.a > 0.0)
        {
            // If the transfer function is nonzero, the integration step is halved
            // First step
            vec4 vol1 = tex3D(iterator - 0.5 * step);
            #if MaskFlag == 1
            {
              vol1.a = vol1.a * tex3DMask(iterator - 0.5 * step).a;
            }
            #endif
            // Transfer function - isosceles triangle
            vec4 valTF1 = texture2D(texTF, vec2(vol1.a, 0.0), 0.0);
            lighting = 0.5 * max(0.0, dot(normalize(vol1.rgb - vec3(0.5, 0.5, 0.5)), lightDir)) + 0.5;
            // Volume integral on the interval StepSize
            sumCol += (1. - sumAlpha) * opacity * valTF1.a * valTF1.rgb * lighting;
//            sumCol += (1. - sumAlpha) * valTF1.rgb * lighting;
            sumAlpha += (1. - sumAlpha) * opacity * valTF1.a;
            // Second step
            // Volume integral on the interval StepSize
            lighting = 0.5 * max(0.0, dot(normalize(vol.rgb - vec3(0.5, 0.5, 0.5)), lightDir)) + 0.5;
            sumCol += (1. - sumAlpha) * opacity * valTF.a * valTF.rgb * lighting;
//            sumCol += (1. - sumAlpha) * valTF.rgb * lighting;
            sumAlpha += (1. - sumAlpha) * opacity * valTF.a;
        }
        count--;
    } // for i
    acc.rgb = BRIGHTNESS_SCALE * brightness3D * sumCol;
    return acc;
}

/**
* Rendering the maximum intensity along the beam
*/
vec4 MipRender(vec3 start, vec3 dir, vec3 back) {
    const int MAX_I = 1000;
    vec4 acc = vec4(0.0, 0.0, 0.0, 2.0);
    float StepSize = stepSize.a, vol, vol1, maxVol = 0.0, finish;
    vec3 step = StepSize*dir, iterator = start;
    for (int i = 0; i < MAX_I; i++)
    {
        iterator = iterator + step;
        vol = tex3D(iterator).a;
        #if MaskFlag == 1
        {
          vol = vol * tex3DMask(iterator).a;
        }
        #endif
        finish = distance(iterator, back) - StepSize;
        if (finish < 0.0)
            break;
         maxVol = max(maxVol, vol);
    } // for i
    acc.rgb = maxVol * t_function2min.rgb;
    return acc;
}


/**
* Finding the point of intersection of a ray with an isosurface
*/
vec4 SkipZero(vec3 start, vec3 dir, vec3 back, float StepSize) {
    const int MAX_I = 1000;
    vec3 iterator = start;
    vec4 acc = vec4(0.0, 0.0, 0.0, 2.0);
    float vol, valTF;
    vec3 left, right, step = StepSize*dir;
    int count = int(floor(length(iterator - back) / StepSize));
    if (count < 2)
        return acc;
    //Search isosurface
    for (int i = 0; i < MAX_I; i++) {
      iterator = iterator + step;
      vol = tex3D(iterator).a;
      #if MaskFlag == 1
      {
        vol = vol * tex3DMask(iterator).a;
      }
     #endif
      valTF = texture2D(texTF, vec2(vol, 0.0), 0.0).a;
      if (count <= 0 || valTF > 0.0)
        break;
      count--;
    }
    //Refinement of the coordinate of the isosurface
    if (count > 0){
        left = iterator - step;
        iterator = CorrectionZero(left, iterator);
        acc = vec4(iterator, length(start - iterator));
    }
    return acc;
  }

/**
* Finding the point of intersection of a ray with an isosurface
*/
vec4 Isosurface(vec3 start, vec3 dir, vec3 back, float threshold, float StepSize) {
    const int MAX_I = 1000;
    vec3 iterator = start;
    vec4 acc = vec4(0.0, 0.0, 0.0, 2.0);
    float vol;
    vec3 left, right, step = StepSize*dir;
    int count = int(floor(length(iterator - back) / StepSize));
    if (count < 2)
        return acc;
//    if (tex3D(iterator).a > threshold)
//        return vec4(iterator, 0.0);
    //Search isosurface
    for (int i = 0; i < MAX_I; i++) {
      iterator = iterator + step;
      vol = tex3D(iterator).a;
      #if MaskFlag == 1
      {
        vol = vol * tex3DMask(iterator).a;
      }
      #endif
//      if (length(iterator - back) < StepSize || vol > threshold)
      if (count <= 0 || vol > threshold)
        break;
      count--;
    }
    //Refinement of the coordinate of the isosurface
    if (count > 0) {
      left = iterator - step;
      iterator = Correction(left, iterator, threshold);
      acc = vec4(iterator, length(start - iterator));
    }
    return acc;
  }


void main() {
  vec4 acc = vec4(0., 0., 0., 1.);
  // To increase the points of the beginning and end of the ray and its direction
  vec2 tc = screenpos.xy / screenpos.w * 0.5 + 0.5;
  vec4 backTexel = texture2D(texBF, tc, 0.0);
  vec3 back = backTexel.xyz;
  vec4 start = texture2D(texFF, tc, 0.0);
  if (start.a < 0.5)
  {
    gl_FragColor = acc;
    return;
  }
  vec3 dir = normalize(back - start.xyz);
//  const float ISO_VOLUME_STEP_SIZE = 0.0035;
  //Direct volume render

  #if isoRenderFlag == 0
  {
    float vol = tex3D(start.xyz).a;
    if (vol > t_function2min.a)
      acc.rgb = 0.75 * vol * t_function2min.rgb;
    else
    {
      acc = Isosurface(start.xyz, dir, back, t_function1min.a, stepSize.b);
      if (acc.a < 1.9)
        acc.rgb = VolumeRender(acc.rgb, dir, back).rgb;
    }
    gl_FragColor = acc;
    return;
  }
  #endif

  #if isoRenderFlag == 4
  {
    vec4 vol = tex3D(start.xyz);
    if (vol.a > 0.75)
      acc.rgb = 0.75 * vol.rgb;
    else
    {
      acc = Isosurface(start.xyz, dir, back, t_function1min.a, stepSize.b);
      if (acc.a < 1.9)
        acc.rgb = RoiVolumeRender(acc.rgb, dir, back).rgb;
    }
    gl_FragColor = acc;
    return;
  }
  #endif

  #if isoRenderFlag == 3
  {
    acc = SkipZero(start.xyz, dir, back, stepSize.b);
    if (acc.a < 1.9)
      acc.rgb = FullVolumeRender(acc.rgb, dir, back).rgb;
    gl_FragColor = acc;
    return;
  }
  #endif

  //Direct isosurface render
  #if isoRenderFlag == 1
  {
    float valTF = texture2D(texTF, vec2(0.5, 0.0), 0.0).a;
    acc = Isosurface(start.xyz, dir, back, isoThreshold, stepSize.b);
    if (acc.a < 1.9)
    {
        float vol = tex3D(start.xyz).a;
        if (vol > t_function2min.a)
            acc.rgb = 0.75 * vol * t_function2min.rgb;
        else
            acc.rgb = CalcLighting(acc.rgb, dir);
    }
    gl_FragColor = acc;
    return;
  }
  #endif
  //Render of maximum intensity
  #if isoRenderFlag == 2
  {
    acc = Isosurface(start.xyz, dir, back, t_function1min.a, stepSize.b);
    if (acc.a < 1.9)
        acc.rgb = MipRender(acc.xyz, dir, back).rgb;
    gl_FragColor = acc;
    return;
  }
  #endif
 }
