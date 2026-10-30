Studio 64 live assets folder
============================

Put models (.fbx .glb .gltf .obj .zip + their textures) and pictures (.png .jpg .webp .bmp .gif)
in here, in any sub-folders you like.

In Studio 64: Assets -> Live tab.
  1. Turn on "Live reload".
  2. Check the files or whole folders you want watched (uncheck what you don't need: fewer checked
     files = faster checks).
  3. Bring a file into the project from this folder (Models -> Choose files -> "From the live assets
     folder", or Textures / Materials / Sky -> choose a picture -> "From the live assets folder").
     Models and pictures you imported earlier by drag & drop are linked automatically when a file
     with the same name is in here.

Now save over the file in Blender / Photoshop / anything: the game picks the change up within a
second or two and replaces it in place (Mario keeps running). Every reload is one undo step.

Tip: keep each model with its textures in its own sub-folder. A model re-reads the textures next to it.
