# Art plan, in plain English

For working through the art. Not a to-do list for the code.

You can paint whenever you want. None of the code steps need a finished set of pictures.

## The order

**1. Make the battle cheaper to draw.**
Before a battle is full of moving units, stop redrawing things that do not change. The mist, the sky, and each unit picture should be drawn once and reused. The sea should be a looping tile, not thousands of little dashes every frame. Add switches to turn the fancy versions off on a weak laptop.

**2. Finish the still pictures, and mark where parts attach.**
Touch up any sprite that needs it. Add national markings. Soldiers do not get them. Ships do not get a roundel on the hull. Hull numbers and flags come later, because numbers flip when a unit faces the other way, and flags are cloth that should move.

While that is happening, name the joints on anything that will move by itself: where the propeller sits, where the turret turns, where the wing meets the body, where the gun fires. Write down which part is in front. Infantry parts, vehicle parts, and ship parts do not mix.

**3. Cut off the parts that move, and trace the parts that do not.**
Take the propeller, the wheels or tracks, the turret, and the gun off the body before you animate them. One film of the whole plane cannot spin the propeller and fire the guns at the same time.

Once a body, wing, or turret is finished, trace it once and look hard at thin pieces like barrels and struts. If the curve looks wrong, fix the pixels and trace it again. Let parts overlap a little so the join does not draw a double outline.

**4. Animate in eights.**
Side view only. The game already flips the picture for the other facing. You do not need eight directions.

- Idle can be one picture, or a small breath of two.
- Moving is eight pictures of the thing that actually changes shape, such as the tracks or the wake. The body stays the one traced picture. A loop is about three quarters of a second. Tracks should move forward by one full link each loop, or they will look like they are sliding.
- A propeller is a blur of two or three pictures. Eight pictures of a three-blade propeller will flicker.
- A shot is on the gun only. The flash lasts one or two ticks, then the barrel settles and a small puff of smoke appears. The body keeps doing whatever it was doing.
- Turning a turret or kicking a gun backwards is a rotation of the one traced part, not eight new drawings. Eight drawings of a turn only gives you a coarse swing.

Check combinations in the battle preview as you go: a body, a propeller, a turret, a gun, at the real speed.

**5. Put them in a real battle, as ordinary pictures.**
Swap the old drawn units for these pictures. Keep the flip, the shadow, the smoke, the wakes, and the way a wreck stops moving. Look at a bomber next to a tank and fix the sizes so both read clearly. Aircraft in the air are new work. The old battle draws nothing for them today.

Use the saved pictures, not the vector files, during the battle. Turning a turret is just turning that saved picture around its joint.

**6. Open the parts up for mixing.**
After one full set is animated, save the other pieces the same way: same joints, same colours, same outline, same light from the top left. The screen where someone bolts them together comes after the pieces exist.

**7. Let parts turn and change size in the battle.**
This is the moment the traced pictures start earning their keep. A turret can turn, a gun can kick, and a plane can tip a few degrees, without you drawing new frames. Tip a plane only a little. It is a side view, so a big tip just looks like the whole picture leaned over.

**8. Lighting last.**
Paint a height picture for each part, at the larger traced size, lined up with the same joint. When the sun, a muzzle, an explosion, or a flare changes, relight the part. Turning a turret turns its lighting picture with it. Smoke and flares sit on top, and they follow the shot, not the animation frame.

## Rules that do not change

- Stay on the sixteen colours.
- Every picture in a loop is the same size, and stands on the same point. If the size changes, the shadow pulses.
- The other facing is a mirror. Anything written on the side has to survive being flipped, or sit in the middle.
- The animation is cosmetic. The battle rules do not look at which frame is showing. Speeding the battle up speeds the propellers too, so a replay always looks the same.
