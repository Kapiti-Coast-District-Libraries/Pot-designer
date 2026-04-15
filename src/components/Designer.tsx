import React, { useState, useDeferredValue, useCallback } from 'react';
import * as THREE from 'three';
import { Viewport } from './Viewport';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { Download, Settings2, Box, Ruler, Droplets, Palette, Info, AlertTriangle, Sparkles, DollarSign, Weight, Dices, Plus, Trash2, Move, RotateCw, Maximize } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { PotParameters, buildPotGeometry, calculateVolume, Attachment, buildAttachmentBridge, getBaseRadius } from '../lib/GeometryBuilder';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const COST_PER_GRAM = 0.10; // $0.10 per gram

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ControlGroup = ({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) => (
  <div className="mb-6">
    <div className="flex items-center gap-2 mb-3 px-1">
      <Icon size={14} className="text-[#8E9299]" />
      <h3 className="text-[10px] font-mono uppercase tracking-[0.15em] text-[#8E9299]">{title}</h3>
    </div>
    <div className="space-y-4 bg-[#1E1F23] p-4 rounded-lg border border-[#2A2B2F]">
      {children}
    </div>
  </div>
);

const Slider = ({ label, value, min, max, step = 1, unit = 'mm', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) => (
  <div className="space-y-2">
    <div className="flex justify-between items-center">
      <label className="text-[11px] font-medium text-[#FFFFFF] opacity-80">{label}</label>
      <span className="text-[11px] font-mono text-[#8E9299]">{value}{unit}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1 bg-[#2A2B2F] rounded-lg appearance-none cursor-pointer accent-[#FFFFFF]"
    />
  </div>
);

const Select = ({ label, value, options, onChange }: { label: string; value: string; options: { label: string; value: string }[]; onChange: (v: any) => void }) => (
  <div className="space-y-2">
    <label className="text-[11px] font-medium text-[#FFFFFF] opacity-80 block">{label}</label>
    <div className="grid grid-cols-3 gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "text-[10px] py-2 rounded border transition-all uppercase tracking-wider font-mono",
            value === opt.value 
              ? "bg-[#FFFFFF] text-[#151619] border-[#FFFFFF]" 
              : "bg-transparent text-[#8E9299] border-[#2A2B2F] hover:border-[#8E9299]"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

export const Designer: React.FC = () => {
  const [params, setParams] = useState<PotParameters>({
    topRadius: 60,
    bottomRadius: 40,
    height: 100,
    wallThickness: 3,
    bottomThickness: 5,
    drainageHoleDiameter: 15,
    shapeProfile: 'linear',
    segments: 64,
    textureType: 'none',
    textureDepth: 2,
    textureScale: 10,
    textureSmoothing: 1.0,
    // Advanced Texture parameters
    textureRotation: 0,
    textureTwist: 0,
    textureXScale: 1,
    textureYScale: 1,
    textureZOffset: 0,
    enforceOverhangLimit: true,
    // Embossing controls
    textureMode: 'smooth',
    textureBandStart: 0,
    textureBandEnd: 1,
    // Estimation parameters
    infill: 20, // %
    materialDensity: 1.24, // g/cm3 (PLA)
    attachments: [],
  });

  const [color, setColor] = useState('#D4D4D8');
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Defer params for smoother viewport updates
  const deferredParams = useDeferredValue(params);

  const stats = React.useMemo(() => {
    const geometry = buildPotGeometry(deferredParams);
    const volumeMm3 = calculateVolume(geometry);
    const volumeCm3 = volumeMm3 / 1000;
    
    // Weight calculation:
    // We assume walls are 100% solid (standard for 3D printing thin walls)
    // But we allow the user to adjust the material density.
    // The 'infill' parameter here is a global multiplier for the volume to account for 
    // internal air gaps if the user prints with low infill.
    // However, since this is a shell, most of it IS wall. 
    // A better estimate for 3D printing: Weight = Volume * Density * (Infill/100)
    // But perimeters are always 100%. For a pot, perimeters = ~80% of volume.
    const effectiveInfill = 0.8 + (0.2 * (deferredParams.infill / 100));
    const weightGrams = volumeCm3 * deferredParams.materialDensity * effectiveInfill;
    const cost = weightGrams * COST_PER_GRAM;
    
    return {
      volume: volumeCm3,
      weight: weightGrams,
      cost: cost
    };
  }, [deferredParams]);

  const handleParamChange = (key: keyof PotParameters, value: any) => {
    setParams(prev => ({ ...prev, [key]: value }));
  };

  const exportSTL = useCallback(() => {
    setIsExporting(true);
    setTimeout(() => {
      try {
        const geometries: THREE.BufferGeometry[] = [];
        
        // Helper to prepare geometry for merging (strip everything except position and normal)
        const prepareGeom = (g: THREE.BufferGeometry) => {
          let cleaned = g.clone();
          if (cleaned.index) {
            cleaned = cleaned.toNonIndexed();
          }
          
          const final = new THREE.BufferGeometry();
          final.setAttribute('position', cleaned.getAttribute('position').clone());
          if (cleaned.hasAttribute('normal')) {
            final.setAttribute('normal', cleaned.getAttribute('normal').clone());
          } else {
            final.computeVertexNormals();
          }
          return final;
        };

        console.log("Export: Building pot geometry...");
        geometries.push(prepareGeom(buildPotGeometry(params)));
        
        // 2. The Bridges and Clips
        params.attachments.forEach((att, idx) => {
          console.log(`Export: Processing attachment ${idx + 1}...`);
          // Bridge
          geometries.push(prepareGeom(buildAttachmentBridge(att, params)));
          
          // Clip
          if (att.geometry) {
            const clipGeom = att.geometry.clone();
            const r = getBaseRadius(att.heightPos, params.bottomRadius, params.topRadius, params.shapeProfile) + att.distanceOffset;
            
            // Apply transforms to the geometry for export
            const euler = new THREE.Euler(0, -att.angle + Math.PI / 2, 0, 'XYZ');
            clipGeom.applyQuaternion(new THREE.Quaternion().setFromEuler(euler));
            
            clipGeom.translate(
              Math.cos(att.angle) * r,
              att.heightPos * params.height,
              Math.sin(att.angle) * r
            );
            
            geometries.push(prepareGeom(clipGeom));
          }
        });

        console.log(`Export: Merging ${geometries.length} geometries...`);
        const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);
        if (!mergedGeometry) {
          throw new Error("Failed to merge geometries for export. Check for attribute mismatches.");
        }

        console.log("Export: Generating STL...");
        const mesh = new THREE.Mesh(mergedGeometry);
        const exporter = new STLExporter();
        const stlResult = exporter.parse(mesh, { binary: true });
        
        const blob = new Blob([stlResult], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `pot-design-${Date.now()}.stl`;
        link.click();
        URL.revokeObjectURL(url);
        console.log("Export: Success!");
      } catch (err) {
        console.error("Export failed:", err);
        alert("Export failed. Please check the console for details.");
      } finally {
        setIsExporting(false);
      }
    }, 100);
  }, [params]);

  const addClip = () => {
    const loader = new STLLoader();
    loader.load('/clip.stl', (geometry) => {
      const newAttachment: Attachment = {
        id: Math.random().toString(36).substr(2, 9),
        stlUrl: '/clip.stl',
        name: 'Clip',
        angle: 0,
        heightPos: 0.95,
        distanceOffset: 2,
        mountingWidth: 11.3,
        mountingHeight: 35,
        tilt: 0,
        geometry: geometry
      };

      setParams(prev => ({
        ...prev,
        attachments: [...prev.attachments, newAttachment]
      }));
    }, undefined, (error) => {
      console.error("Error loading clip.stl:", error);
      alert("Could not load clip.stl. Make sure it is uploaded to the public folder as 'clip.stl'.");
    });
  };

  const updateAttachment = (id: string, updates: Partial<Attachment>) => {
    setParams(prev => ({
      ...prev,
      attachments: prev.attachments.map(a => a.id === id ? { ...a, ...updates } : a)
    }));
  };

  const removeAttachment = (id: string) => {
    setParams(prev => ({
      ...prev,
      attachments: prev.attachments.filter(a => a.id !== id)
    }));
  };

  const randomize = useCallback(() => {
    const textureTypes: PotParameters['textureType'][] = [
      'ribbed', 'rings', 'diamond', 'organic', 'perlin', 'spiral', 
      'waves', 'dots', 'scales', 'honeycomb', 'voronoi', 'faceted', 
      'grid', 'bricks', 'chevron', 'herringbone'
    ];
    const textureModes: PotParameters['textureMode'][] = ['smooth', 'emboss', 'engrave'];
    
    const newParams: Partial<PotParameters> = {
      height: 40 + Math.random() * 160,
      topRadius: 30 + Math.random() * 70,
      bottomRadius: 30 + Math.random() * 70,
      wallThickness: 1.5 + Math.random() * 3,
      bottomThickness: 2 + Math.random() * 6,
      drainageHoleDiameter: Math.random() > 0.3 ? 5 + Math.random() * 20 : 0,
      textureType: textureTypes[Math.floor(Math.random() * textureTypes.length)],
      textureDepth: 1 + Math.random() * 6,
      textureScale: 5 + Math.random() * 25,
      textureSmoothing: 0.2 + Math.random() * 0.8,
      textureRotation: Math.random() * Math.PI * 2,
      textureTwist: (Math.random() - 0.5) * 4,
      textureXScale: 0.7 + Math.random() * 1.3,
      textureYScale: 0.7 + Math.random() * 1.3,
      textureZOffset: Math.random(),
      textureMode: textureModes[Math.floor(Math.random() * textureModes.length)],
    };

    setParams(prev => ({ ...prev, ...newParams }));
    
    // Randomize color
    const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    setColor(randomColor);
  }, []);

  return (
    <div className="flex h-screen bg-[#151619] text-[#FFFFFF] font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-[380px] h-full border-r border-[#2A2B2F] flex flex-col bg-[#151619] z-10 shadow-2xl">
        <div className="p-6 border-bottom border-[#2A2B2F]">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-[#FFFFFF] rounded flex items-center justify-center">
                <Sparkles size={20} className="text-[#151619]" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight leading-tight">Kapiti Libraries</h1>
                <p className="text-[9px] font-mono text-[#8E9299] uppercase tracking-widest">Custom Plant Pot Maker</p>
              </div>
            </div>
            <button 
              onClick={randomize}
              className="p-2 hover:bg-[#2A2B2F] rounded-lg transition-colors text-[#8E9299] hover:text-[#FFFFFF]"
              title="Randomize Design"
            >
              <Dices size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
          <ControlGroup title="Dimensions" icon={Ruler}>
            <Slider 
              label="Height" 
              value={params.height} 
              min={20} max={240} 
              onChange={(v) => handleParamChange('height', v)} 
            />
            <Slider 
              label="Top Radius" 
              value={params.topRadius} 
              min={10} max={115} 
              onChange={(v) => handleParamChange('topRadius', v)} 
            />
            <Slider 
              label="Bottom Radius" 
              value={params.bottomRadius} 
              min={10} max={115} 
              onChange={(v) => handleParamChange('bottomRadius', v)} 
            />
          </ControlGroup>

          <ControlGroup title="Physical Specs" icon={Droplets}>
            <Slider 
              label="Wall Thickness" 
              value={params.wallThickness} 
              min={1} max={10} step={0.5} 
              onChange={(v) => handleParamChange('wallThickness', v)} 
            />
            <Slider 
              label="Bottom Thickness" 
              value={params.bottomThickness} 
              min={1} max={20} step={0.5} 
              onChange={(v) => handleParamChange('bottomThickness', v)} 
            />
            <Slider 
              label="Drainage Hole" 
              value={params.drainageHoleDiameter} 
              min={0} max={50} 
              onChange={(v) => handleParamChange('drainageHoleDiameter', v)} 
            />
          </ControlGroup>

          <ControlGroup title="Surface Styling" icon={Sparkles}>
            <Select 
              label="Pattern" 
              value={params.textureType} 
              options={[
                { label: 'None', value: 'none' },
                { label: 'Ribs', value: 'ribbed' },
                { label: 'Rings', value: 'rings' },
                { label: 'Spiral', value: 'spiral' },
                { label: 'Waves', value: 'waves' },
                { label: 'Diamond', value: 'diamond' },
                { label: 'Scales', value: 'scales' },
                { label: 'Honeycomb', value: 'honeycomb' },
                { label: 'Voronoi', value: 'voronoi' },
                { label: 'Faceted', value: 'faceted' },
                { label: 'Grid', value: 'grid' },
                { label: 'Bricks', value: 'bricks' },
                { label: 'Chevron', value: 'chevron' },
                { label: 'Herringbone', value: 'herringbone' },
                { label: 'Stone', value: 'organic' },
                { label: 'Perlin', value: 'perlin' },
                { label: 'Dots', value: 'dots' }
              ]} 
              onChange={(v) => handleParamChange('textureType', v)} 
            />
            {params.textureType !== 'none' && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-4 pt-2"
              >
                <Select 
                  label="Texture Style" 
                  value={params.textureMode} 
                  options={[
                    { label: 'Smooth (Sine)', value: 'smooth' },
                    { label: 'Emboss (Sharp)', value: 'emboss' },
                    { label: 'Engrave (Recessed)', value: 'engrave' }
                  ]} 
                  onChange={(v) => handleParamChange('textureMode', v)} 
                />
                <Slider 
                  label="Depth" 
                  value={params.textureDepth} 
                  min={0} max={10} step={0.1} 
                  onChange={(v) => handleParamChange('textureDepth', v)} 
                />
                <Slider 
                  label="Scale" 
                  value={params.textureScale} 
                  min={1} max={50} step={0.1} 
                  onChange={(v) => handleParamChange('textureScale', v)} 
                />
                {params.textureType === 'ribbed' && (
                  <Slider 
                    label="Rib Profile" 
                    value={params.textureSmoothing} 
                    min={0.1} max={1} step={0.01} 
                    onChange={(v) => handleParamChange('textureSmoothing', v)} 
                  />
                )}
              </motion.div>
            )}
          </ControlGroup>

          {params.textureType !== 'none' && (
            <ControlGroup title="Pattern Placement" icon={Box}>
              <Slider 
                label="Band Start" 
                value={params.textureBandStart} 
                min={0} max={1} step={0.01} unit="%"
                onChange={(v) => handleParamChange('textureBandStart', v)} 
              />
              <Slider 
                label="Band End" 
                value={params.textureBandEnd} 
                min={0} max={1} step={0.01} unit="%"
                onChange={(v) => handleParamChange('textureBandEnd', v)} 
              />
              <p className="text-[9px] text-[#8E9299] mt-2 leading-relaxed">
                Limit the pattern to a specific vertical band on the pot.
              </p>
            </ControlGroup>
          )}

          {params.textureType !== 'none' && (
            <ControlGroup title="Advanced Patterns" icon={Settings2}>
              <Slider 
                label="Pattern Rotation" 
                value={params.textureRotation} 
                min={0} max={Math.PI * 2} step={0.01} unit="rad"
                onChange={(v) => handleParamChange('textureRotation', v)} 
              />
              <Slider 
                label="Pattern Twist" 
                value={params.textureTwist} 
                min={-Math.PI * 2} max={Math.PI * 2} step={0.01} unit="rad"
                onChange={(v) => handleParamChange('textureTwist', v)} 
              />
              <Slider 
                label="Horizontal Stretch" 
                value={params.textureXScale} 
                min={0.1} max={5} step={0.1} unit="x"
                onChange={(v) => handleParamChange('textureXScale', v)} 
              />
              <Slider 
                label="Vertical Stretch" 
                value={params.textureYScale} 
                min={0.1} max={5} step={0.1} unit="x"
                onChange={(v) => handleParamChange('textureYScale', v)} 
              />
              <Slider 
                label="Vertical Offset" 
                value={params.textureZOffset} 
                min={-1} max={1} step={0.01} unit="%"
                onChange={(v) => handleParamChange('textureZOffset', v)} 
              />
            </ControlGroup>
          )}

          <ControlGroup title="Style & Quality" icon={Settings2}>
            <Select 
              label="Shape Profile" 
              value={params.shapeProfile} 
              options={[
                { label: 'Linear', value: 'linear' },
                { label: 'Curved', value: 'curved' },
                { label: 'Geo', value: 'geometric' }
              ]} 
              onChange={(v) => handleParamChange('shapeProfile', v)} 
            />
            <Slider 
              label="Mesh Detail" 
              value={params.segments} 
              min={3} max={128} 
              unit=""
              onChange={(v) => handleParamChange('segments', v)} 
            />

            <div className="pt-2">
              <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className={cn("transition-colors", params.enforceOverhangLimit ? "text-[#EAB308]" : "text-[#8E9299]")} />
                  <span className="text-[11px] font-medium text-[#FFFFFF] opacity-80">Enforce 45° Overhang</span>
                </div>
                <div 
                  onClick={() => handleParamChange('enforceOverhangLimit', !params.enforceOverhangLimit)}
                  className={cn(
                    "w-8 h-4 rounded-full transition-colors relative",
                    params.enforceOverhangLimit ? "bg-[#4ADE80]" : "bg-[#2A2B2F]"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-2 h-2 bg-white rounded-full transition-transform",
                    params.enforceOverhangLimit ? "left-5" : "left-1"
                  )} />
                </div>
              </label>
              <p className="text-[9px] text-[#8E9299] mt-2 leading-relaxed">
                Clamps the outward slope to 45° to ensure the pot is 3D printable without supports.
              </p>
            </div>
          </ControlGroup>

          <ControlGroup title="Slicer Settings" icon={Settings2}>
            <Slider 
              label="Infill Density" 
              value={params.infill} 
              min={0} max={100} step={5} unit="%"
              onChange={(v) => handleParamChange('infill', v)} 
            />
            <Select 
              label="Material" 
              value={params.materialDensity.toString()} 
              options={[
                { label: 'PLA (1.24g/cm³)', value: '1.24' },
                { label: 'PETG (1.27g/cm³)', value: '1.27' },
                { label: 'ABS (1.04g/cm³)', value: '1.04' },
                { label: 'TPU (1.21g/cm³)', value: '1.21' }
              ]} 
              onChange={(v) => handleParamChange('materialDensity', parseFloat(v))} 
            />
            <p className="text-[9px] text-[#8E9299] mt-2 leading-relaxed">
              Adjust these to improve the accuracy of the weight and cost estimation.
            </p>
          </ControlGroup>

          <ControlGroup title="Custom Attachments" icon={Plus}>
            <div className="space-y-4">
              <button 
                onClick={addClip}
                className="w-full py-3 px-4 bg-[#2A2B2F] hover:bg-[#3A3B3F] border border-[#3A3B3F] rounded-lg flex items-center justify-center gap-2 text-[11px] font-medium text-[#FFFFFF] transition-all"
              >
                <Plus size={14} />
                Add Clip
              </button>

              <AnimatePresence>
                {params.attachments.map((att) => (
                  <motion.div 
                    key={att.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="p-3 bg-[#1E1F23] rounded-lg border border-[#2A2B2F] space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-[#FFFFFF] truncate max-w-[150px]">{att.name}</span>
                      <button 
                        onClick={() => removeAttachment(att.id)}
                        className="p-1 text-[#8E9299] hover:text-[#FF4444] transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="space-y-2">
                      <Slider 
                        label="Position (Angle)" 
                        value={att.angle} 
                        min={0} max={Math.PI * 2} step={0.01} unit="rad"
                        onChange={(v) => updateAttachment(att.id, { angle: v })} 
                      />
                      <Slider 
                        label="Position (Height)" 
                        value={att.heightPos} 
                        min={0} max={1} step={0.01} unit="%"
                        onChange={(v) => updateAttachment(att.id, { heightPos: v })} 
                      />
                      <Slider 
                        label="Dist. from Wall" 
                        value={att.distanceOffset} 
                        min={-10} max={50} step={0.5} unit="mm"
                        onChange={(v) => updateAttachment(att.id, { distanceOffset: v })} 
                      />
                      <Slider 
                        label="Manual Tilt" 
                        value={att.tilt} 
                        min={-Math.PI / 4} max={Math.PI / 4} step={0.01} unit="rad"
                        onChange={(v) => updateAttachment(att.id, { tilt: v })} 
                      />
                      
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#2A2B2F]">
                        <div className="space-y-1">
                          <span className="text-[9px] text-[#8E9299] uppercase">Mount Width</span>
                          <input 
                            type="number" 
                            value={att.mountingWidth}
                            onChange={(e) => updateAttachment(att.id, { mountingWidth: parseFloat(e.target.value) })}
                            className="w-full bg-[#151619] border border-[#2A2B2F] rounded px-2 py-1 text-[10px] text-white"
                          />
                        </div>
                        <div className="space-y-1">
                          <span className="text-[9px] text-[#8E9299] uppercase">Mount Height</span>
                          <input 
                            type="number" 
                            value={att.mountingHeight}
                            onChange={(e) => updateAttachment(att.id, { mountingHeight: parseFloat(e.target.value) })}
                            className="w-full bg-[#151619] border border-[#2A2B2F] rounded px-2 py-1 text-[10px] text-white"
                          />
                        </div>
                      </div>
                      <p className="text-[8px] text-[#8E9299] leading-tight">
                        The mount area flattens the pot's pattern and creates a solid bridge to the inner wall.
                      </p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </ControlGroup>

          <ControlGroup title="Appearance" icon={Palette}>
            <div className="flex items-center gap-4">
              <div className="relative group">
                <input 
                  type="color" 
                  value={color} 
                  onChange={(e) => setColor(e.target.value)}
                  className="w-12 h-12 rounded-lg border-2 border-[#2A2B2F] bg-transparent cursor-pointer overflow-hidden appearance-none"
                />
              </div>
              <div className="flex-1">
                <p className="text-[11px] font-medium text-white/90">Material Finish</p>
                <p className="text-[10px] font-mono text-[#8E9299] uppercase tracking-wider">{color}</p>
              </div>
            </div>
          </ControlGroup>
        </div>

        <div className="p-6 border-t border-[#2A2B2F] space-y-3">
          <button
            onClick={() => setShowAnalysis(!showAnalysis)}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-3 rounded-lg text-[12px] font-bold uppercase tracking-wider transition-all border",
              showAnalysis 
                ? "bg-[#FF4444]/10 text-[#FF4444] border-[#FF4444]" 
                : "bg-transparent text-[#8E9299] border-[#2A2B2F] hover:border-[#8E9299]"
            )}
          >
            <AlertTriangle size={16} />
            {showAnalysis ? "Hide Analysis" : "Analyze Overhangs"}
          </button>
          
          <button
            onClick={exportSTL}
            disabled={isExporting}
            className="w-full flex items-center justify-center gap-2 bg-[#FFFFFF] text-[#151619] py-4 rounded-lg text-[12px] font-bold uppercase tracking-widest hover:bg-[#E6E6E6] transition-all disabled:opacity-50"
          >
            {isExporting ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#151619] border-t-transparent" />
            ) : (
              <Download size={18} />
            )}
            {isExporting ? "Processing..." : "Export STL File"}
          </button>
        </div>
      </div>

      {/* Main Viewport Area */}
      <div className="flex-1 p-6 relative">
        <Viewport params={deferredParams} color={color} showAnalysis={showAnalysis} />
        
        {/* Info Overlay */}
        <div className="absolute top-10 right-10 flex flex-col gap-2 pointer-events-none">
          <div className="bg-[#1E1F23]/80 backdrop-blur-md p-5 rounded-lg border border-[#2A2B2F] shadow-xl min-w-[200px]">
            <div className="flex items-center gap-2 mb-4">
              <Info size={14} className="text-[#FFFFFF]" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#8E9299]">Print Estimation</span>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Weight size={14} className="text-[#8E9299]" />
                  <span className="text-[11px] text-[#8E9299]">Weight</span>
                </div>
                <span className="text-[12px] font-mono font-bold">{Math.round(stats.weight)}g</span>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign size={14} className="text-[#8E9299]" />
                  <span className="text-[11px] text-[#8E9299]">Cost</span>
                </div>
                <span className="text-[12px] font-mono font-bold text-[#4ADE80]">${stats.cost.toFixed(2)}</span>
              </div>

              <div className="pt-3 border-t border-[#2A2B2F]">
                <div className="flex justify-between items-center opacity-50 mb-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider">Volume</span>
                  <span className="text-[10px] font-mono">{Math.round(stats.volume)} cm³</span>
                </div>
                <div className="flex justify-between items-center opacity-50">
                  <span className="text-[10px] font-mono uppercase tracking-wider">Settings</span>
                  <span className="text-[10px] font-mono">{params.infill}% Infill</span>
                </div>
              </div>
            </div>
          </div>
          
          {showAnalysis && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-[#FF4444]/10 backdrop-blur-md p-4 rounded-lg border border-[#FF4444]/30 shadow-xl"
            >
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle size={14} className="text-[#FF4444]" />
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#FF4444]">Overhang Warning</span>
              </div>
              <p className="text-[10px] text-[#FF4444]/80 max-w-[200px]">Red areas indicate slopes steeper than 45°. These may require supports during 3D printing.</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};
