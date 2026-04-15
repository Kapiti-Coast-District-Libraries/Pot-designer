import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { PotParameters, buildPotGeometry, buildAttachmentBridge, getBaseRadius } from '../lib/GeometryBuilder';

interface ViewportProps {
  params: PotParameters;
  color: string;
  showAnalysis: boolean;
}

const PotMaterial = ({ color, showAnalysis }: { color: string; showAnalysis: boolean }) => {
  const materialRef = React.useRef<THREE.MeshStandardMaterial>(null);
  const uniforms = React.useRef({
    uShowAnalysis: { value: showAnalysis ? 1.0 : 0.0 }
  });

  // Update uniforms when showAnalysis changes
  React.useEffect(() => {
    uniforms.current.uShowAnalysis.value = showAnalysis ? 1.0 : 0.0;
  }, [showAnalysis]);

  return (
    <meshStandardMaterial
      ref={materialRef}
      color={color}
      roughness={0.4}
      metalness={0.1}
      side={THREE.DoubleSide}
      onBeforeCompile={(shader) => {
        shader.uniforms.uShowAnalysis = uniforms.current.uShowAnalysis;
        
        shader.vertexShader = `
          varying vec3 vWorldNormal;
          ${shader.vertexShader}
        `.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
           vWorldNormal = normalize( transformedNormal );`
        );

        shader.fragmentShader = `
          uniform float uShowAnalysis;
          varying vec3 vWorldNormal;
          ${shader.fragmentShader}
        `.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           if (uShowAnalysis > 0.5) {
             float dotUp = dot(vWorldNormal, vec3(0.0, 1.0, 0.0));
             if (dotUp < 0.707) {
               diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.0, 0.0), 0.8);
             }
           }
          `
        );
      }}
    />
  );
};

export const Viewport: React.FC<ViewportProps> = ({ params, color, showAnalysis }) => {
  const geometry = useMemo(() => buildPotGeometry(params), [params]);

  return (
    <div className="w-full h-full bg-[#151619] rounded-xl overflow-hidden border border-[#2A2B2F] shadow-2xl relative">
      <Canvas camera={{ position: [150, 150, 150], fov: 45 }} shadows>
        <color attach="background" args={['#151619']} />
        
        <ambientLight intensity={0.7} />
        <hemisphereLight intensity={0.4} color="#ffffff" groundColor="#444444" />
        <spotLight position={[100, 200, 100]} angle={0.3} penumbra={1} intensity={2} castShadow />
        <pointLight position={[-100, 100, -100]} intensity={1} color="#4444ff" />
        
        <group position={[0, 0, 0]}>
          <mesh geometry={geometry} castShadow receiveShadow>
            <PotMaterial color={color} showAnalysis={showAnalysis} />
          </mesh>

          {params.attachments.map((att) => {
            const r = getBaseRadius(att.heightPos, params.bottomRadius, params.topRadius, params.shapeProfile) + att.distanceOffset;
            const x = Math.cos(att.angle) * r;
            const y = att.heightPos * params.height;
            const z = Math.sin(att.angle) * r;

            return (
              <group key={att.id}>
                {/* The Bridge (Projection) - Now visible in render */}
                <mesh geometry={buildAttachmentBridge(att, params)} castShadow>
                  <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
                </mesh>

                {/* The Clip STL */}
                {att.geometry && (
                  <mesh 
                    geometry={att.geometry} 
                    position={[x, y, z]}
                    rotation={[0, -att.angle + Math.PI / 2, 0]}
                    castShadow
                  >
                    <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
                  </mesh>
                )}
              </group>
            );
          })}
        </group>

        <Grid
          infiniteGrid
          fadeDistance={500}
          fadeStrength={5}
          cellSize={10}
          sectionSize={50}
          sectionColor="#2A2B2F"
          cellColor="#1E1F23"
        />
        
        <ContactShadows 
          opacity={0.4} 
          scale={200} 
          blur={2.4} 
          far={10} 
          resolution={256} 
          color="#000000" 
        />

        <OrbitControls makeDefault target={[0, params.height / 2, 0]} />
        <Environment preset="city" />
      </Canvas>
      
      <div className="absolute bottom-4 left-4 text-[10px] font-mono text-[#8E9299] uppercase tracking-wider bg-[#151619]/80 px-2 py-1 rounded border border-[#2A2B2F]">
        Viewport: 1 Unit = 1mm
      </div>
    </div>
  );
};
