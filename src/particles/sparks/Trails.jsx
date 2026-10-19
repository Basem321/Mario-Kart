import * as THREE from 'three'
import { useRef, useMemo } from 'react'
import { MeshLineGeometry, MeshLineMaterial } from 'meshline'
import { extend, useFrame } from '@react-three/fiber'
import { useGameStore } from '../../store'

extend({ MeshLineGeometry, MeshLineMaterial })

// Accepts an optional driftLevelOverride so remote karts can drive the
// trail with network data instead of reading the local player's store.
export const Trails = ({ radius = 1, left, driftLevelOverride }) => {
  const points = useMemo(() => {
    const pts = []
    const initialPos = new THREE.Vector3(0, 0, 0)
    const dirX = Math.random() * radius * 5
    const dirY = 3 + Math.random() * 2
    const dirZ = Math.random() * radius
    pts.push(initialPos.clone())

    for (let j = 1; j < 10; j++) {
      const randomPos = new THREE.Vector3(left ? dirX : -dirX, dirY, -dirZ)
      randomPos.y -= j * 2
      pts.push(pts[j - 1].clone().add(randomPos))
    }

    return new THREE.CatmullRomCurve3(pts).getPoints(300).flatMap(p => p.toArray())
  }, [radius, left])

  return (
    <Fatline
      curve={points}
      width={0.005}
      color={new THREE.Color(0xFFFFFF).multiplyScalar(100)}
      speed={2}
      radius={radius}
      left={left}
      driftLevelOverride={driftLevelOverride}
    />
  )
}

function Fatline({ curve, width, color, speed, radius, left, driftLevelOverride}) {
  const ref = useRef()
  const geoRef = useRef()
  const lastColorRef = useRef("")
  useFrame((_, delta) => {
    if (!ref.current || !ref.current.material) return
    // driftLevelOverride lets remote karts supply their own level without
    // touching the local player's store. Fallback = local store (unchanged
    // behaviour for the local kart).
    const driftLevel = driftLevelOverride ?? useGameStore.getState().driftLevel;
      if(driftLevel && driftLevel.level >= 1){
      ref.current.material.dashOffset -= delta * speed / 5;
      ref.current.visible = true;

      if (ref.current.material.dashOffset < -0.2) {
        const pts = []
        const initialPos = new THREE.Vector3(0, 0, 0)
        const dirX = Math.random() * 5
        const dirY = 2 + Math.random() * 3
        const dirZ = 1 + Math.random() * radius
        pts.push(initialPos.clone())

        for (let j = 1; j < 10; j++) {
          const randomPos = new THREE.Vector3(left ? dirX : -dirX, dirY, -dirZ)
          randomPos.y -= j * 1.6
          pts.push(pts[j - 1].clone().add(randomPos))
        }

        const newCurve = new THREE.CatmullRomCurve3(pts).getPoints(300).flatMap(p => p.toArray())
        geoRef.current.setPoints(newCurve)
        ref.current.material.dashOffset = 0
      }
      // Cache the color: allocating a THREE.Color every frame churns GC.
      if (driftLevel.color !== lastColorRef.current) {
        lastColorRef.current = driftLevel.color;
        ref.current.material.color.set(driftLevel.color).multiplyScalar(100);
      }
    } else {
      ref.current.material.dashOffset = 0
      ref.current.visible = false;
    
    }
  })

  return (
    <mesh ref={ref} scale={0.6}>
      <meshLineGeometry ref={geoRef} points={curve} />
      <meshLineMaterial
        transparent
        lineWidth={width}
        color={color}
        depthWrite={false}
        dashArray={1}
        dashRatio={0.97}
      />
    </mesh>
  )
}
