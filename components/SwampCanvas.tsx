
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Plant, Particle, Fish, Point2D, PlantType, Crab, Chunk, Hologram } from '../types';
import { project3DTo2D, randomRange, DEFAULT_FOCAL_LENGTH } from '../utils/math';
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";

const CHUNK_SIZE = 3000;
const RENDER_DISTANCE_CHUNKS = 1; // 1 means 3x3 grid (center + 1 neighbor)
const VISIBILITY_DEPTH = 3500;

// Per Chunk Counts
const PLANTS_PER_CHUNK = 40; 
const FISH_PER_CHUNK = 15;
const CRABS_PER_CHUNK = 4;

const PARTICLE_COUNT = 600; // Still global/camera relative

// Physics Constants
const FRICTION = 0.85; 
const ACCELERATION = 1.5;
const MAX_SPEED = 20;
const GRAVITY = 0.8;
const JUMP_FORCE = 18;
const FLOOR_LEVEL = 1350; 
const SURFACE_LEVEL = 0; 
const PLAYER_HEIGHT = 140; 

const SwampCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [chunkInfo, setChunkInfo] = useState("0, 0");
  
  // Input State
  const mouseRef = useRef({ x: 0, y: 0 });
  const keysRef = useRef<Set<string>>(new Set());
  
  // UI Action State
  const uiRef = useRef({
    jump: false,
    zoomIn: false,
    zoomOut: false,
    forward: false,
    backward: false,
    left: false,
    right: false
  });

  // AI State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<{role: string, text: string}[]>([
    {role: 'model', text: "Greetings from the Deep Swamp! I control this world. Ask me to spawn creatures, change the vibe, or imagine a huge picture."}
  ]);
  const [isAiThinking, setIsAiThinking] = useState(false);

  // Camera & Physics State
  const cameraRef = useRef({ 
    x: 0, 
    y: FLOOR_LEVEL - PLAYER_HEIGHT, 
    z: -800, 
    focalLength: DEFAULT_FOCAL_LENGTH,
    targetFocalLength: DEFAULT_FOCAL_LENGTH,
    lookX: 0, 
    lookY: 0,
    velX: 0,
    velY: 0,
    velZ: 0,
    rotationZ: 0,
    isGrounded: false
  });

  // World Data
  const chunksRef = useRef<Map<string, Chunk>>(new Map());
  const particlesRef = useRef<Particle[]>([]);
  const hologramsRef = useRef<Hologram[]>([]);
  
  // Environment Ref (controlled by AI)
  const envRef = useRef({
    skyHue: 180, // Cyan/Teal
    fogDensity: 1.0,
    gravityMult: 1.0,
  });

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const { innerWidth, innerHeight } = window;
    mouseRef.current.x = (e.clientX / innerWidth) * 2 - 1;
    mouseRef.current.y = (e.clientY / innerHeight) * 2 - 1;
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    cameraRef.current.targetFocalLength -= e.deltaY;
    e.preventDefault();
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isChatOpen) return; // Disable controls when chatting
    keysRef.current.add(e.code);
  }, [isChatOpen]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    keysRef.current.delete(e.code);
  }, []);

  const setUiAction = (action: keyof typeof uiRef.current, active: boolean) => {
    uiRef.current[action] = active;
  };

  // --- AI LOGIC ---
  const handleSendMessage = async () => {
    if (!chatInput.trim() || isAiThinking) return;

    const userMsg = chatInput;
    setChatInput("");
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsAiThinking(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const updateEnvironmentTool: FunctionDeclaration = {
        name: "updateEnvironment",
        description: "Update the swamp environment (color, fog, gravity).",
        parameters: {
          type: Type.OBJECT,
          properties: {
            skyHue: { type: Type.NUMBER, description: "0-360 Hue for sky/water." },
            fogDensity: { type: Type.NUMBER, description: "0.1 to 2.0 fog density." },
            gravityMult: { type: Type.NUMBER, description: "0.1 to 2.0 gravity multiplier (1 is normal)." }
          }
        }
      };

      const spawnCreatureTool: FunctionDeclaration = {
        name: "spawnCreature",
        description: "Spawn a group of creatures near the player.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                type: { type: Type.STRING, description: "fish, crab, or particle" },
                count: { type: Type.NUMBER, description: "Number to spawn (1-50)" },
                hue: { type: Type.NUMBER, description: "Color hue (0-360)" }
            },
            required: ["type", "count"]
        }
      };
      
      const generateHologramTool: FunctionDeclaration = {
          name: "generateHologram",
          description: "Generate a HUGE picture/hologram of a creature or object using AI image generation and place it in the world.",
          parameters: {
              type: Type.OBJECT,
              properties: {
                  prompt: { type: Type.STRING, description: "Description of the image to generate." }
              },
              required: ["prompt"]
          }
      };

      const model = "gemini-2.5-flash";
      
      const result = await ai.models.generateContent({
        model,
        contents: [
            { role: 'user', parts: [{ text: `Current Context: You are the Swamp Spirit. User says: "${userMsg}"` }] }
        ],
        config: {
            tools: [{ functionDeclarations: [updateEnvironmentTool, spawnCreatureTool, generateHologramTool] }],
            systemInstruction: "You are the Swamp Spirit. You control this 3D world. You can change colors, spawn fish, or generate massive holograms (images) if the user asks for a 'huge picture' or 'image'. Be mysterious but helpful."
        }
      });

      const response = result.candidates?.[0]?.content;
      if (!response) throw new Error("No response");

      const parts = response.parts || [];
      let textResponse = "";

      for (const part of parts) {
        if (part.text) {
            textResponse += part.text;
        }
        if (part.functionCall) {
            const { name, args } = part.functionCall;
            
            if (name === "updateEnvironment") {
                const { skyHue, fogDensity, gravityMult } = args as any;
                if (skyHue !== undefined) envRef.current.skyHue = skyHue;
                if (fogDensity !== undefined) envRef.current.fogDensity = fogDensity;
                if (gravityMult !== undefined) envRef.current.gravityMult = gravityMult;
                textResponse += ` [Environment Shifted: Hue ${skyHue}, Fog ${fogDensity}]`;
            }
            
            if (name === "spawnCreature") {
                 const { type, count, hue } = args as any;
                 // Spawn in current chunk(s)
                 const currentChunkKey = chunkInfo.replace(", ", ","); // "0, 0" -> "0,0" (approx)
                 // Better: just push to the closest chunk or a temp list
                 // For simplicity, we inject into the first active chunk we find or current camera chunk
                 const cx = Math.floor(cameraRef.current.x / CHUNK_SIZE);
                 const cz = Math.floor(cameraRef.current.z / CHUNK_SIZE);
                 const key = `${cx},${cz}`;
                 const chunk = chunksRef.current.get(key);
                 
                 if (chunk) {
                     for(let i=0; i<count; i++) {
                         if (type === 'fish') {
                             chunk.fishes.push({
                                id: Math.random(),
                                x: cameraRef.current.x + randomRange(-500, 500),
                                y: cameraRef.current.y - randomRange(100, 500),
                                z: cameraRef.current.z + randomRange(200, 1000),
                                speed: randomRange(4, 10),
                                size: randomRange(30, 80),
                                hue: hue || randomRange(0, 360),
                                tailPhase: 0,
                                targetY: FLOOR_LEVEL - 300,
                                targetX: cameraRef.current.x,
                                targetZ: cameraRef.current.z + 1000
                             });
                         }
                     }
                     textResponse += ` [Spawned ${count} ${type}s]`;
                 } else {
                     textResponse += " [Could not spawn - no active chunk]";
                 }
            }

            if (name === "generateHologram") {
                const { prompt } = args as any;
                textResponse += " [Generating Huge Hologram...]";
                // Trigger async image gen
                ai.models.generateImages({
                    model: 'imagen-4.0-generate-001',
                    prompt: prompt + ", swamp aesthetic, bioluminescent, 8k, 3d render style",
                    config: { numberOfImages: 1, aspectRatio: '1:1' }
                }).then(imgRes => {
                    const b64 = imgRes.generatedImages?.[0]?.image?.imageBytes;
                    if (b64) {
                        const img = new Image();
                        img.src = `data:image/png;base64,${b64}`;
                        img.onload = () => {
                            hologramsRef.current.push({
                                id: Math.random().toString(),
                                x: cameraRef.current.x,
                                y: cameraRef.current.y - 400,
                                z: cameraRef.current.z + 800, // In front of player
                                width: 800,
                                height: 800,
                                image: img,
                                opacity: 0
                            });
                        };
                    }
                }).catch(e => console.error("Image Gen failed", e));
            }
        }
      }

      if (textResponse) {
          setChatHistory(prev => [...prev, { role: 'model', text: textResponse }]);
      } else {
          setChatHistory(prev => [...prev, { role: 'model', text: "I have listened, but I have nothing to say." }]);
      }

    } catch (e) {
        console.error(e);
        setChatHistory(prev => [...prev, { role: 'model', text: "The spirits are silent (Error)." }]);
    } finally {
        setIsAiThinking(false);
    }
  };


  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleMouseMove, handleWheel, handleKeyDown, handleKeyUp, isChatOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let animationId: number;
    let time = 0;
    let lastChunkCheckX = -9999;
    let lastChunkCheckZ = -9999;

    // --- GENERATION LOGIC ---

    const createPlant = (baseX: number, baseZ: number): Plant => {
        const typeRoll = Math.random();
        let type: PlantType = 'ribbon';
        if (typeRoll > 0.7) type = 'stalk';
        else if (typeRoll > 0.9) type = 'bulb';

        const x = baseX + randomRange(0, CHUNK_SIZE);
        const z = baseZ + randomRange(0, CHUNK_SIZE);
        
        return {
            id: Math.random(),
            type,
            x,
            z,
            yBase: FLOOR_LEVEL + randomRange(0, 50), 
            height: type === 'stalk' ? randomRange(1500, 2500) : randomRange(600, 1600),
            width: type === 'stalk' ? randomRange(15, 40) : randomRange(8, 25),
            colorHue: randomRange(140, 175), 
            segments: type === 'stalk' ? 4 : Math.floor(randomRange(8, 16)),
            phaseOffset: randomRange(0, Math.PI * 2),
            stiffness: type === 'stalk' ? 0.2 : randomRange(0.8, 1.5),
        };
    };

    const generateChunk = (cx: number, cz: number): Chunk => {
        const chunkId = `${cx},${cz}`;
        const baseX = cx * CHUNK_SIZE;
        const baseZ = cz * CHUNK_SIZE;
        
        const newPlants: Plant[] = [];
        const newFishes: Fish[] = [];
        const newCrabs: Crab[] = [];

        for (let i = 0; i < PLANTS_PER_CHUNK; i++) {
            newPlants.push(createPlant(baseX, baseZ));
        }

        for (let i = 0; i < FISH_PER_CHUNK; i++) {
            const x = baseX + randomRange(0, CHUNK_SIZE);
            const z = baseZ + randomRange(0, CHUNK_SIZE);
            newFishes.push({
                id: Math.random(),
                x,
                y: randomRange(SURFACE_LEVEL + 200, FLOOR_LEVEL - 200), 
                z,
                speed: randomRange(4, 8),
                size: randomRange(30, 70),
                hue: randomRange(0, 360),
                tailPhase: randomRange(0, Math.PI * 2),
                targetY: randomRange(SURFACE_LEVEL + 200, FLOOR_LEVEL - 200),
                targetX: x + randomRange(-500, 500),
                targetZ: z + randomRange(-500, 500)
            });
        }

        for (let i = 0; i < CRABS_PER_CHUNK; i++) {
            newCrabs.push({
                id: Math.random(),
                x: baseX + randomRange(0, CHUNK_SIZE),
                y: FLOOR_LEVEL, 
                z: baseZ + randomRange(0, CHUNK_SIZE),
                size: randomRange(30, 60),
                walkPhase: Math.random() * 100,
                targetX: baseX + randomRange(0, CHUNK_SIZE),
                targetZ: baseZ + randomRange(0, CHUNK_SIZE),
                speed: randomRange(1, 3),
                state: 'idle',
                idleTimer: 0
            });
        }

        return {
            id: chunkId,
            xIndex: cx,
            zIndex: cz,
            plants: newPlants,
            fishes: newFishes,
            crabs: newCrabs
        };
    };

    const manageChunks = () => {
        const cam = cameraRef.current;
        const cx = Math.floor(cam.x / CHUNK_SIZE);
        const cz = Math.floor(cam.z / CHUNK_SIZE);

        if (cx === lastChunkCheckX && cz === lastChunkCheckZ) return;

        lastChunkCheckX = cx;
        lastChunkCheckZ = cz;
        setChunkInfo(`${cx}, ${cz}`);

        const activeKeys = new Set<string>();

        // Generate needed chunks
        for (let x = cx - RENDER_DISTANCE_CHUNKS; x <= cx + RENDER_DISTANCE_CHUNKS; x++) {
            for (let z = cz - RENDER_DISTANCE_CHUNKS; z <= cz + RENDER_DISTANCE_CHUNKS; z++) {
                const key = `${x},${z}`;
                activeKeys.add(key);
                if (!chunksRef.current.has(key)) {
                    chunksRef.current.set(key, generateChunk(x, z));
                }
            }
        }

        // Prune distant chunks
        for (const [key, chunk] of chunksRef.current.entries()) {
            const dist = Math.max(Math.abs(chunk.xIndex - cx), Math.abs(chunk.zIndex - cz));
            if (dist > RENDER_DISTANCE_CHUNKS + 1) { 
                chunksRef.current.delete(key);
            }
        }
    };

    const initParticles = () => {
        particlesRef.current = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particlesRef.current.push({
                x: randomRange(-2000, 2000),
                y: randomRange(SURFACE_LEVEL, FLOOR_LEVEL),
                z: randomRange(0, VISIBILITY_DEPTH), // Relative Z
                radius: randomRange(0.5, 3),
                speedX: randomRange(-0.5, 0.5),
                speedY: randomRange(-0.5, -0.1),
                alpha: randomRange(0.1, 0.8),
                glow: Math.random() > 0.9,
            });
        }
    };

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };

    window.addEventListener('resize', handleResize);
    handleResize();
    initParticles();
    setIsLoading(false);

    // --- DRAWING HELPERS ---

    const drawCrab = (ctx: CanvasRenderingContext2D, crab: Crab, p: Point2D, distFactor: number) => {
        const scale = p.scale;
        const size = crab.size * scale;
        const legSpan = size * 1.2;
        
        ctx.save();
        ctx.translate(p.x, p.y);
        
        // Shadow
        ctx.fillStyle = `rgba(0,0,0,${0.5 * distFactor})`;
        ctx.beginPath();
        ctx.ellipse(0, size * 0.2, size * 0.8, size * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();

        // Legs animation
        const phase = crab.state === 'walking' ? time * 0.01 : 0;
        ctx.strokeStyle = `hsla(10, 80%, ${50 * distFactor}%, ${distFactor})`;
        ctx.lineWidth = 4 * scale;
        ctx.lineCap = 'round';
        
        for (let i = 0; i < 4; i++) {
            const legLift = Math.sin(phase + i * 1.5) * (size * 0.3);
            
            // Left Legs
            ctx.beginPath();
            ctx.moveTo(-size * 0.3, 0);
            ctx.quadraticCurveTo(
                -legSpan, -size * 0.5 + legLift,
                -legSpan * 1.2, size * 0.5 + legLift
            );
            ctx.stroke();
            
            // Right Legs
            ctx.beginPath();
            ctx.moveTo(size * 0.3, 0);
            ctx.quadraticCurveTo(
                legSpan, -size * 0.5 + -legLift,
                legSpan * 1.2, size * 0.5 + -legLift
            );
            ctx.stroke();
        }

        // Body
        ctx.fillStyle = `hsla(0, 70%, ${60 * distFactor}%, ${distFactor})`; 
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 0.6, size * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // Eyes
        ctx.fillStyle = `rgba(255,255,255,${distFactor})`;
        ctx.beginPath();
        ctx.arc(-size * 0.2, -size * 0.25, size * 0.15, 0, Math.PI * 2);
        ctx.arc(size * 0.2, -size * 0.25, size * 0.15, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = `rgba(0,0,0,${distFactor})`;
        ctx.beginPath();
        ctx.arc(-size * 0.2, -size * 0.25, size * 0.05, 0, Math.PI * 2);
        ctx.arc(size * 0.2, -size * 0.25, size * 0.05, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    };

    const drawSpongeCharacter = (ctx: CanvasRenderingContext2D, width: number, height: number, cam: any) => {
        const cx = width / 2;
        const cy = height / 2;
        const bob = Math.sin(time * 0.005) * 5;
        const lean = cam.velX * 0.02;
        
        const isMoving = Math.abs(cam.velX) > 0.1 || Math.abs(cam.velZ) > 0.1;
        const walkPhase = isMoving ? time * 0.015 : 0;
        const leftLegY = Math.sin(walkPhase) * 10;
        const rightLegY = Math.sin(walkPhase + Math.PI) * 10;
        const armSwing = isMoving ? Math.cos(walkPhase) * 0.5 : Math.sin(time * 0.003) * 0.1;

        ctx.save();
        ctx.translate(cx, cy + bob + 50); 
        ctx.rotate(lean);
        ctx.scale(0.8, 0.8);

        // Legs - FIXED: Moved attachment point up to connect to body
        const drawLeg = (x: number, yOffset: number, isLeft: boolean) => {
            ctx.save();
            // Originally 100, body bottom is ~50. Changed to 50 to connect.
            ctx.translate(x, 50 + yOffset);
            ctx.fillStyle = '#8B4513';
            ctx.fillRect(-10, 0, 20, 20);
            ctx.fillStyle = '#FFD700'; 
            ctx.fillRect(-5, 20, 10, 40);
            ctx.fillStyle = '#FFF';
            ctx.fillRect(-6, 45, 12, 25);
            ctx.strokeStyle = '#F00';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-6, 50); ctx.lineTo(6, 50); ctx.stroke();
            ctx.strokeStyle = '#00F';
            ctx.beginPath(); ctx.moveTo(-6, 55); ctx.lineTo(6, 55); ctx.stroke();
            ctx.fillStyle = '#111';
            ctx.beginPath();
            ctx.ellipse(0, 70, 15, 10, 0, 0, Math.PI*2);
            ctx.fill();
            ctx.restore();
        };
        
        drawLeg(-30, leftLegY, true);
        drawLeg(30, rightLegY, false);

        // Body
        ctx.save();
        const bodyGrad = ctx.createLinearGradient(-60, -100, 60, 100);
        bodyGrad.addColorStop(0, '#FFFF00');
        bodyGrad.addColorStop(1, '#E6C200');
        ctx.fillStyle = bodyGrad;
        ctx.strokeStyle = '#BDB76B';
        ctx.lineWidth = 3;
        
        ctx.beginPath();
        const rectW = 120;
        const rectH = 140;
        const x = -rectW/2;
        const y = -rectH/2 - 20; // -90
        // Bottom Y is -90 + 140 = 50. Leg starts at 50.
        ctx.roundRect(x, y, rectW, rectH, 10);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'rgba(180, 180, 0, 0.4)';
        [{x: -30, y: -50, r: 8}, {x: 40, y: -20, r: 12}, {x: -20, y: 40, r: 6}, {x: 30, y: 60, r: 10}, {x: 0, y: 0, r: 5}]
        .forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
            ctx.fill();
        });

        ctx.fillStyle = '#8B4513';
        ctx.fillRect(x, y + rectH - 30, rectW, 30);
        ctx.fillStyle = '#111';
        ctx.setLineDash([10, 5]);
        ctx.strokeStyle = '#111';
        ctx.beginPath();
        ctx.moveTo(x + 5, y + rectH - 15);
        ctx.lineTo(x + rectW - 5, y + rectH - 15);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#FFF';
        ctx.fillRect(x, y + rectH - 60, rectW, 30);
        
        ctx.fillStyle = '#F00';
        ctx.beginPath();
        ctx.moveTo(0, y + rectH - 55); 
        ctx.lineTo(10, y + rectH - 45);
        ctx.lineTo(0, y + rectH - 15); 
        ctx.lineTo(-10, y + rectH - 45);
        ctx.fill();

        const drawArm = (side: number) => {
            ctx.save();
            ctx.translate(side * 65, -20);
            ctx.rotate(side * armSwing);
            ctx.fillStyle = '#FFF';
            ctx.fillRect(-10, -10, 20, 20);
            ctx.fillStyle = '#FFFF00';
            ctx.fillRect(-5, 10, 10, 50);
            ctx.beginPath();
            ctx.arc(0, 65, 10, 0, Math.PI*2);
            ctx.fill();
            ctx.restore();
        };
        drawArm(-1);
        drawArm(1);

        ctx.restore(); 
        ctx.restore();
    };

    const drawLensDroplets = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
        ctx.save();
        const count = 5;
        for (let i = 0; i < count; i++) {
            const x = (Math.sin(i * 123 + time * 0.0001) * 0.5 + 0.5) * width;
            const y = (Math.cos(i * 321 + time * 0.00015) * 0.5 + 0.5) * height;
            const size = 10 + Math.sin(i) * 5;
            const alpha = 0.05 + Math.sin(time * 0.0005 + i) * 0.02;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 1.5})`;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        ctx.restore();
    };

    // --- RENDER LOOP ---
    const render = (timestamp: number) => {
      time = timestamp;
      const cam = cameraRef.current;
      const mouse = mouseRef.current;
      const keys = keysRef.current;
      const ui = uiRef.current;

      // 1. Physics & Controls
      let ax = 0;
      let az = 0;
      
      // Disable movement if chat is open
      if (!isChatOpen) {
        if (keys.has('KeyW') || keys.has('ArrowUp') || ui.forward) az += ACCELERATION;
        if (keys.has('KeyS') || keys.has('ArrowDown') || ui.backward) az -= ACCELERATION;
        if (keys.has('KeyA') || keys.has('ArrowLeft') || ui.left) ax -= ACCELERATION;
        if (keys.has('KeyD') || keys.has('ArrowRight') || ui.right) ax += ACCELERATION;
      }
      
      cam.velX += ax;
      cam.velZ += az;

      if (!isChatOpen && (keys.has('Space') || ui.jump) && cam.isGrounded) {
          cam.velY = -JUMP_FORCE * envRef.current.gravityMult;
          cam.isGrounded = false;
      }
      cam.velY += GRAVITY * envRef.current.gravityMult;

      if (!isChatOpen && (keys.has('KeyQ') || ui.zoomIn)) cam.targetFocalLength += 10;
      if (!isChatOpen && (keys.has('KeyE') || ui.zoomOut)) cam.targetFocalLength -= 10;
      
      cam.targetFocalLength = Math.max(300, Math.min(2000, cam.targetFocalLength));
      cam.focalLength += (cam.targetFocalLength - cam.focalLength) * 0.1;

      cam.velX = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, cam.velX));
      cam.velZ = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, cam.velZ));
      
      cam.x += cam.velX;
      cam.y += cam.velY;
      cam.z += cam.velZ;

      const floorY = FLOOR_LEVEL - PLAYER_HEIGHT;
      if (cam.y > floorY) {
          cam.y = floorY;
          cam.velY = 0;
          cam.isGrounded = true;
      } else {
          cam.isGrounded = false;
      }

      cam.rotationZ += (cam.velX * 0.001 - cam.rotationZ) * 0.1;
      cam.velX *= FRICTION;
      cam.velZ *= FRICTION;
      if (!isChatOpen) {
        cam.lookX += (mouse.x * 600 - cam.lookX) * 0.1;
        cam.lookY += (mouse.y * 400 - cam.lookY) * 0.1;
      }

      // 2. Manage Chunks (Load/Unload)
      manageChunks();

      const centerX = width / 2;
      const centerY = height / 2;
      
      // 3. Clear Screen with Env State
      const skyOffset = cam.lookY * 0.8;
      const hue = envRef.current.skyHue;
      const bgGrad = ctx.createLinearGradient(0, 0 + skyOffset, 0, height + skyOffset);
      bgGrad.addColorStop(0, `hsla(${hue}, 50%, 90%, 1)`);
      bgGrad.addColorStop(0.3, `hsla(${hue}, 60%, 60%, 1)`);
      bgGrad.addColorStop(0.7, `hsla(${hue + 10}, 80%, 30%, 1)`);
      bgGrad.addColorStop(1, `hsla(${hue + 20}, 90%, 10%, 1)`);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // God Rays
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.translate(centerX - cam.lookX * 0.2, centerY - cam.lookY * 0.2 - 200); 
      ctx.rotate(-0.2 - cam.rotationZ * 0.5);
      
      for (let i = 0; i < 12; i++) {
          const rayW = 100 + Math.sin(time * 0.0003 + i) * 50;
          const rayH = height * 3;
          const alpha = (Math.sin(time * 0.001 + i * 1.5) + 1) * 0.15;
          const rayGrad = ctx.createLinearGradient(-100, 0, 100, rayH);
          rayGrad.addColorStop(0, `rgba(255, 255, 230, ${alpha})`); 
          rayGrad.addColorStop(1, `rgba(255, 255, 255, 0)`);
          ctx.fillStyle = rayGrad;
          ctx.beginPath();
          ctx.moveTo(i * 150 - 800, 0);
          ctx.lineTo(i * 150 - 700 + rayW, 0);
          ctx.lineTo(i * 200 - 600 + Math.sin(time*0.001)*100, rayH);
          ctx.lineTo(i * 200 - 900 + Math.sin(time*0.001)*100, rayH);
          ctx.fill();
      }
      ctx.restore();

      // 4. Render Queue Logic
      interface RenderItem {
        z: number;
        draw: () => void;
      }
      const renderQueue: RenderItem[] = [];
      const fogDensity = envRef.current.fogDensity;

      const pushRenderItem = (itemX: number, itemY: number, itemZ: number, drawFn: (distFactor: number, p: Point2D) => void) => {
         const relZ = itemZ - cam.z;
         
         // Strict visibility cull
         if (relZ < 1 || relZ > VISIBILITY_DEPTH) return;

         // Apply fog density from state
         const distFactor = Math.max(0, 1 - (relZ / (VISIBILITY_DEPTH / fogDensity))); 
         
         const rCos = Math.cos(cam.rotationZ);
         const rSin = Math.sin(cam.rotationZ);
         
         renderQueue.push({
            z: relZ,
            draw: () => {
                const p = project3DTo2D(
                    { x: itemX, y: itemY, z: itemZ }, 
                    cam.x + cam.lookX * 0.5, 
                    cam.y + cam.lookY * 0.5, 
                    cam.z, 
                    centerX, 
                    centerY,
                    cam.focalLength
                );
                
                // Apply banking rotation screen space
                const finalX = (p.x - centerX) * rCos - (p.y - centerY) * rSin + centerX;
                const finalY = (p.x - centerX) * rSin + (p.y - centerY) * rCos + centerY;
                
                drawFn(distFactor, { ...p, x: finalX, y: finalY });
            }
         });
      };

      // --- SURFACE WATER MESH ---
      if (cam.lookY > -500) {
        // Render mesh around camera
        const gridRange = 2000;
        const step = 500;
        const startX = Math.floor((cam.x - gridRange) / step) * step;
        const endX = Math.floor((cam.x + gridRange) / step) * step;
        const startZ = Math.floor((cam.z - gridRange) / step) * step;
        const endZ = Math.floor((cam.z + gridRange) / step) * step;

        for(let z = startZ; z <= endZ; z+=step) {
            for(let x = startX; x <= endX; x+=step) {
                const waveY = Math.sin(x * 0.01 + time * 0.002) * 50 + Math.cos(z * 0.01 + time * 0.003) * 50;
                pushRenderItem(x, SURFACE_LEVEL + waveY, z, (distFactor, p) => {
                     ctx.fillStyle = `rgba(255, 255, 255, ${0.1 * distFactor})`;
                     ctx.beginPath();
                     ctx.arc(p.x, p.y, 200 * p.scale, 0, Math.PI*2);
                     ctx.fill();
                });
            }
        }
      }

      // --- PROCESS ACTIVE CHUNKS ---
      chunksRef.current.forEach((chunk) => {
          
          // 1. Crabs
          chunk.crabs.forEach(crab => {
            if (crab.state === 'idle') {
                crab.idleTimer--;
                if (crab.idleTimer <= 0) {
                    crab.state = 'walking';
                    crab.targetX = crab.x + randomRange(-400, 400);
                    crab.targetZ = crab.z + randomRange(-200, 200);
                }
            } else {
                const dx = crab.targetX - crab.x;
                const dz = crab.targetZ - crab.z;
                const dist = Math.sqrt(dx*dx + dz*dz);
                if (dist < 10) {
                    crab.state = 'idle';
                    crab.idleTimer = randomRange(50, 200);
                } else {
                    crab.x += (dx / dist) * crab.speed;
                    crab.z += (dz / dist) * crab.speed;
                }
            }
            pushRenderItem(crab.x, crab.y, crab.z, (distFactor, p) => drawCrab(ctx, crab, p, distFactor));
          });

          // 2. Fish
          chunk.fishes.forEach(fish => {
            fish.targetY += (Math.random() - 0.5) * 20;
            fish.targetY = Math.max(SURFACE_LEVEL + 100, Math.min(FLOOR_LEVEL - 100, fish.targetY));
            fish.y += (fish.targetY - fish.y) * 0.01;
            
            const dx = fish.targetX - fish.x;
            const dz = fish.targetZ - fish.z;
            const dist = Math.sqrt(dx*dx + dz*dz);

            if (dist < 20) {
                fish.targetX = (chunk.xIndex * CHUNK_SIZE) + randomRange(0, CHUNK_SIZE);
                fish.targetZ = (chunk.zIndex * CHUNK_SIZE) + randomRange(0, CHUNK_SIZE);
            }

            // Move towards target
            fish.x += (dx / dist) * fish.speed * 0.5;
            fish.z += (dz / dist) * fish.speed * 0.5;

            // Avoid Camera
            const camDx = fish.x - cam.x;
            const camDz = fish.z - cam.z;
            const distToCam = Math.sqrt(camDx*camDx + camDz*camDz);
            if (distToCam < 200) {
                fish.x += (camDx > 0 ? 5 : -5);
            }

            pushRenderItem(fish.x, fish.y, fish.z, (distFactor, p) => {
                const s = fish.size * p.scale;
                fish.tailPhase += 0.2;
                const tail = Math.sin(fish.tailPhase) * 15 * p.scale;
                
                ctx.save();
                ctx.translate(p.x, p.y);
                const angle = Math.atan2(dz, dx);
                
                if (dx < 0) ctx.scale(-1, 1);

                ctx.rotate(Math.sin(time * 0.001 + fish.id) * 0.1);
                
                ctx.fillStyle = `hsla(${fish.hue}, 90%, 60%, ${distFactor})`;
                ctx.strokeStyle = `hsla(${fish.hue}, 90%, 30%, ${distFactor})`;
                ctx.lineWidth = 1;
                
                ctx.beginPath();
                ctx.moveTo(0, -s * 0.5);
                ctx.bezierCurveTo(s, -s * 0.5, s * 1.5, s * 0.5, 0, s); 
                ctx.bezierCurveTo(-s * 1.5, s * 0.5, -s, -s * 0.5, 0, -s * 0.5); 
                ctx.fill();
                ctx.stroke();
                
                ctx.beginPath();
                ctx.moveTo(-s, 0);
                ctx.lineTo(-s * 1.5, -s * 0.5 + tail);
                ctx.lineTo(-s * 1.5, s * 0.5 + tail);
                ctx.lineTo(-s, 0);
                ctx.fillStyle = `hsla(${fish.hue}, 90%, 50%, ${distFactor})`;
                ctx.fill();
                
                ctx.fillStyle = 'white';
                ctx.beginPath();
                ctx.arc(s * 0.5, -s * 0.2, s * 0.2, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = 'black';
                ctx.beginPath();
                ctx.arc(s * 0.6, -s * 0.2, s * 0.08, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });
          });

          // 3. Plants
          chunk.plants.forEach((plant) => {
            pushRenderItem(plant.x, plant.yBase, plant.z, (distFactor, rootP) => {
                const alpha = distFactor;
                ctx.save();
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                if (plant.type === 'stalk') {
                    const tipY = plant.yBase - plant.height;
                    const tipScreenY = rootP.y - plant.height * rootP.scale; 
                    const sway = Math.sin(time * 0.001 + plant.id) * 30 * distFactor * rootP.scale;

                    ctx.beginPath();
                    ctx.moveTo(rootP.x, rootP.y);
                    ctx.quadraticCurveTo(rootP.x + sway, (rootP.y + tipScreenY)/2, rootP.x + sway, tipScreenY);
                    ctx.lineWidth = plant.width * rootP.scale;
                    ctx.strokeStyle = `hsla(${plant.colorHue}, 60%, ${20 + 30 * distFactor}%, ${alpha})`; 
                    ctx.stroke();
                    
                    ctx.beginPath();
                    ctx.arc(rootP.x + sway, tipScreenY, plant.width * 1.5 * rootP.scale, 0, Math.PI * 2);
                    ctx.fillStyle = `hsla(${plant.colorHue + 20}, 80%, ${40 * distFactor}%, ${alpha})`;
                    ctx.fill();
                } else {
                    ctx.beginPath();
                    const segmentH = (plant.height / plant.segments) * rootP.scale;
                    let currX = rootP.x;
                    let currY = rootP.y;
                    const w = plant.width * rootP.scale;
                    const pts = [];
                    for(let i=0; i<=plant.segments; i++) {
                        const t = time * 0.0015 * plant.stiffness + plant.phaseOffset + (i * 0.3);
                        const swayX = Math.sin(t) * (i * i * 0.5) * rootP.scale;
                        pts.push({ x: currX + swayX, y: currY });
                        currY -= segmentH;
                    }
                    ctx.moveTo(pts[0].x - w, pts[0].y);
                    for(let i=1; i<pts.length; i++) ctx.lineTo(pts[i].x - w, pts[i].y);
                    for(let i=pts.length-1; i>=0; i--) ctx.lineTo(pts[i].x + w, pts[i].y);
                    ctx.closePath();
                    const grad = ctx.createLinearGradient(rootP.x, rootP.y, rootP.x, pts[pts.length-1].y);
                    grad.addColorStop(0, `hsla(${plant.colorHue - 20}, 90%, 10%, ${alpha})`); 
                    grad.addColorStop(1, `hsla(${plant.colorHue}, 80%, ${50 * distFactor}%, ${alpha})`); 
                    ctx.fillStyle = grad;
                    ctx.fill();
                }
                ctx.restore();
            });
          });
      });

      // --- PARTICLES (Camera Relative) ---
      particlesRef.current.forEach(p => {
         p.y -= Math.abs(p.speedY) * 2 * envRef.current.gravityMult; 
         p.x += Math.sin(time * 0.001 + p.z) * 0.5;
         
         // Recycle relative to camera
         if (p.y < SURFACE_LEVEL) {
             p.y = FLOOR_LEVEL;
             p.x = randomRange(-2000, 2000);
         }

         const worldX = cam.x + p.x;
         const worldZ = cam.z + p.z;

         pushRenderItem(worldX, p.y, worldZ, (distFactor, pos) => {
             ctx.beginPath();
             ctx.arc(pos.x, pos.y, p.radius * pos.scale, 0, Math.PI * 2);
             ctx.fillStyle = `rgba(220, 255, 255, ${p.alpha * distFactor})`;
             ctx.fill();
         });
      });

      // --- HOLOGRAMS ---
      hologramsRef.current.forEach(h => {
         // Fade in
         h.opacity = Math.min(1, h.opacity + 0.01);
         pushRenderItem(h.x, h.y, h.z, (distFactor, p) => {
             const w = h.width * p.scale;
             const hg = h.height * p.scale;
             ctx.save();
             ctx.globalAlpha = distFactor * h.opacity * 0.9;
             ctx.translate(p.x, p.y);
             // Float effect
             const float = Math.sin(time * 0.002) * 20 * p.scale;
             ctx.translate(0, float);
             
             // Draw glow background
             const glow = ctx.createRadialGradient(0,0, w/4, 0,0, w/1.5);
             glow.addColorStop(0, 'rgba(100, 255, 255, 0.5)');
             glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
             ctx.fillStyle = glow;
             ctx.fillRect(-w/1.5, -hg/1.5, w*1.3, hg*1.3);

             // Draw Image
             ctx.drawImage(h.image, -w/2, -hg/2, w, hg);
             
             // Border
             ctx.strokeStyle = 'cyan';
             ctx.lineWidth = 2;
             ctx.strokeRect(-w/2, -hg/2, w, hg);
             
             ctx.restore();
         });
      });

      renderQueue.sort((a, b) => b.z - a.z);
      renderQueue.forEach(item => item.draw());

      drawSpongeCharacter(ctx, width, height, cam);

      // Sun/Glare
      const sunY = centerY - cam.lookY * 0.2 - 400;
      const sunGrad = ctx.createRadialGradient(centerX, sunY, 10, centerX, sunY, 400);
      sunGrad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
      sunGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, width, height);
      
      drawLensDroplets(ctx, width, height);

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
    };
  }, [handleMouseMove, handleWheel, handleKeyDown, handleKeyUp, chunkInfo, isChatOpen]);

  const btnClass = "w-14 h-14 bg-yellow-500/20 border border-yellow-400/40 rounded-full flex items-center justify-center text-yellow-100 hover:bg-yellow-500/40 backdrop-blur-sm transition-all active:scale-95 select-none touch-manipulation shadow-lg";

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#4DD0E1] cursor-pointer select-none">
      <canvas ref={canvasRef} className="block w-full h-full" />
      
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center text-yellow-300 font-bold text-2xl z-50 animate-bounce">
          Generating Infinite Swamp...
        </div>
      )}

      {/* HUD / Title */}
      <div className="absolute top-8 left-0 w-full text-center pointer-events-none z-10 mix-blend-overlay flex flex-col items-center">
        <h1 className="text-5xl md:text-7xl font-black text-white opacity-80 tracking-widest uppercase drop-shadow-xl">
          SHALLOW SWAMP
        </h1>
        <div className="text-white font-mono text-sm mt-2 opacity-60 bg-black/20 px-2 rounded">
            POS: {chunkInfo} | AI: {isAiThinking ? "THINKING..." : "READY"}
        </div>
      </div>

      {/* Chat UI */}
      <div className={`absolute bottom-8 left-8 md:bottom-8 md:left-8 z-30 transition-all duration-300 ease-in-out ${isChatOpen ? 'w-96 h-96' : 'w-14 h-14'}`}>
         {!isChatOpen && (
             <button 
                onClick={() => setIsChatOpen(true)}
                className={`${btnClass} w-14 h-14 bg-cyan-500/30 border-cyan-400 animate-pulse`}
             >
                 🤖
             </button>
         )}
         {isChatOpen && (
             <div className="flex flex-col w-full h-full bg-black/80 backdrop-blur-md border border-cyan-500/50 rounded-lg overflow-hidden shadow-2xl">
                 <div className="flex justify-between items-center p-2 bg-cyan-900/30 border-b border-cyan-500/30">
                     <span className="text-cyan-300 font-mono text-sm font-bold">SWAMP_AI_TERMINAL</span>
                     <button onClick={() => setIsChatOpen(false)} className="text-cyan-500 hover:text-white">✕</button>
                 </div>
                 <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-sm custom-scrollbar">
                     {chatHistory.map((msg, i) => (
                         <div key={i} className={`${msg.role === 'user' ? 'text-right text-yellow-300' : 'text-left text-cyan-300'}`}>
                             <span className="opacity-50 text-xs block mb-1">{msg.role.toUpperCase()}</span>
                             <div className={`inline-block p-2 rounded ${msg.role === 'user' ? 'bg-yellow-900/30' : 'bg-cyan-900/30'}`}>
                                {msg.text}
                             </div>
                         </div>
                     ))}
                     {isAiThinking && <div className="text-cyan-500 animate-pulse">Processing swamp data...</div>}
                 </div>
                 <div className="p-2 border-t border-cyan-500/30 flex gap-2">
                     <input 
                        className="flex-1 bg-black/50 border border-cyan-700 rounded px-2 py-1 text-cyan-100 focus:outline-none focus:border-cyan-400 font-mono"
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                        placeholder="Type command..."
                        autoFocus
                     />
                     <button onClick={handleSendMessage} className="px-3 bg-cyan-700/50 text-cyan-200 rounded hover:bg-cyan-600">SEND</button>
                 </div>
             </div>
         )}
      </div>

      <div className="absolute bottom-8 right-8 flex flex-col gap-4 z-20">
         <div className="flex flex-col gap-2 items-center bg-white/10 p-2 rounded-3xl backdrop-blur-md">
            <button 
                className={btnClass}
                onMouseDown={() => setUiAction('zoomIn', true)}
                onMouseUp={() => setUiAction('zoomIn', false)}
                onMouseLeave={() => setUiAction('zoomIn', false)}
                onTouchStart={() => setUiAction('zoomIn', true)}
                onTouchEnd={() => setUiAction('zoomIn', false)}
            >
                <span className="text-xl font-bold">+</span>
            </button>
            <button 
                className={btnClass}
                onMouseDown={() => setUiAction('zoomOut', true)}
                onMouseUp={() => setUiAction('zoomOut', false)}
                onMouseLeave={() => setUiAction('zoomOut', false)}
                onTouchStart={() => setUiAction('zoomOut', true)}
                onTouchEnd={() => setUiAction('zoomOut', false)}
            >
                 <span className="text-xl font-bold">-</span>
            </button>
         </div>

         <button 
            className={`${btnClass} w-20 h-20 bg-red-500/30 border-red-400`}
            onMouseDown={() => setUiAction('jump', true)}
            onMouseUp={() => setUiAction('jump', false)}
            onMouseLeave={() => setUiAction('jump', false)}
            onTouchStart={() => setUiAction('jump', true)}
            onTouchEnd={() => setUiAction('jump', false)}
         >
            JUMP
         </button>
      </div>
      
      {/* Mobile controls (hidden if chat open for space) */}
      {!isChatOpen && (
      <div className="absolute bottom-8 left-8 md:hidden z-20 grid grid-cols-3 gap-2">
        <div></div>
        <button 
            className={btnClass}
            onMouseDown={() => setUiAction('forward', true)}
            onMouseUp={() => setUiAction('forward', false)}
            onMouseLeave={() => setUiAction('forward', false)}
            onTouchStart={() => setUiAction('forward', true)}
            onTouchEnd={() => setUiAction('forward', false)}
        >↑</button>
        <div></div>
        <button 
            className={btnClass}
            onMouseDown={() => setUiAction('left', true)}
            onMouseUp={() => setUiAction('left', false)}
            onMouseLeave={() => setUiAction('left', false)}
            onTouchStart={() => setUiAction('left', true)}
            onTouchEnd={() => setUiAction('left', false)}
        >←</button>
        <button 
            className={btnClass}
            onMouseDown={() => setUiAction('backward', true)}
            onMouseUp={() => setUiAction('backward', false)}
            onMouseLeave={() => setUiAction('backward', false)}
            onTouchStart={() => setUiAction('backward', true)}
            onTouchEnd={() => setUiAction('backward', false)}
        >↓</button>
        <button 
            className={btnClass}
            onMouseDown={() => setUiAction('right', true)}
            onMouseUp={() => setUiAction('right', false)}
            onMouseLeave={() => setUiAction('right', false)}
            onTouchStart={() => setUiAction('right', true)}
            onTouchEnd={() => setUiAction('right', false)}
        >→</button>
      </div>
      )}
    </div>
  );
};

export default SwampCanvas;
