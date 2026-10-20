import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { AdditiveBlending } from "three";
import { useTexture } from "@react-three/drei";
import gsap from "gsap";



// depthTest=false (default) draws over everything, as on the local kart.
// Remote karts pass true so the flash is hidden behind walls.
export const Spark = forwardRef(({ depthTest = false }, ref) => {
  const texture = useTexture("/textures/particles/spark.png");
  const materialRef = useRef();
  const meshRef = useRef();
  const mountedRef = useRef(true);

  // Tweens outlive unmount: kill them so onComplete never touches a
  // detached mesh ("GSAP target null" spam).
  useEffect(() => {
    mountedRef.current = true;
    const material = materialRef.current;
    const mesh = meshRef.current;
    return () => {
      mountedRef.current = false;
      gsap.killTweensOf(material);
      if (mesh) gsap.killTweensOf(mesh.scale);
    };
  }, []);

  // useFrame((state) => {
  //   if (materialRef.current) {
  //     materialRef.current.uTime = state.clock.getElapsedTime() * 5;
  //   }
  // });
  

  const scaleTarget = 0.3
  
  const animateParticle = () => {
    if (materialRef.current && meshRef.current) {
      gsap.to(materialRef.current, {
        duration: 0.05,
        opacity: 1,
        onComplete: () => {
          if (!mountedRef.current || !materialRef.current) return;
          gsap.to(materialRef.current, {
            duration: 0.1,
            delay: 0.1,
            opacity: 0.0,
            // delay: 0.2
          });
        }
      });
      gsap.to(meshRef.current.scale,{
        duration: 0.2,
        x: scaleTarget,
        y: scaleTarget,
        z: scaleTarget,
        onComplete: () => {
          if (!mountedRef.current || !meshRef.current) return;
          gsap.set(meshRef.current.scale,{
            x: 0,
            y: 0,
            z: 0,
            delay: 0.5  
          })
        }
      })
    }
  };

  useImperativeHandle(ref, () => ({
    emit: () => {
        animateParticle();
    },
    setColor: (newColor) => {
      if (materialRef.current) {
        materialRef.current.color = newColor.multiplyScalar(12);
      }
    },
    mesh: meshRef,
  }));

  return (
    <mesh ref={meshRef} position={[0, 0, 0]} scale={0} >
      <planeGeometry args={[10, 10]} />
      <meshBasicMaterial
        ref={materialRef}
        map={texture}
        transparent
        depthWrite={false}
        depthTest={depthTest}
        blending={AdditiveBlending}
        opacity={0}
      />
    </mesh>
  );
});
