%% Lite3 URDF coordinate-frame display and browser transform audit
% Standalone diagnostic for base MATLAB (no Robotics System Toolbox needed).
% It reads Lite3.urdf, loads the browser's binary STL files, applies the URDF
% joint and visual transforms, and draws every link frame. The right panel
% demonstrates the duplicated 90-degree conversion that caused the broken web
% model.

clear; close all; clc;

scriptDir = fileparts(mfilename('fullpath'));
repoRoot = fileparts(scriptDir);
urdfFile = fullfile(scriptDir, 'Lite3White', 'urdf', 'Lite3.urdf');
meshDir = fullfile(repoRoot, 'museum', 'models', 'lite3', 'meshes');
assert(isfile(urdfFile), 'Lite3 URDF was not found: %s', urdfFile);
assert(isfolder(meshDir), 'Converted browser meshes were not found: %s', meshDir);

[visuals, jointByChild] = parseLite3Urdf(urdfFile);
transformCache = containers.Map('KeyType', 'char', 'ValueType', 'any');

figure('Name', 'Lite3 URDF visual and link-frame audit', 'Color', 'w');
layout = tiledlayout(1, 2, 'TileSpacing', 'compact', 'Padding', 'compact');

%% Correct URDF assembly
axRobot = nexttile(layout, 1);
hold(axRobot, 'on'); grid(axRobot, 'on'); axis(axRobot, 'equal');

for visualIndex = 1:numel(visuals)
    visual = visuals(visualIndex);
    meshFile = fullfile(meshDir, visual.meshFile);
    assert(isfile(meshFile), 'Missing converted mesh: %s', meshFile);
    mesh = stlread(meshFile);

    Tlink = linkTransform(visual.linkName, jointByChild, transformCache);
    Tvisual = translationMatrix(visual.xyz) * rpyMatrix(visual.rpy);
    Tworld = Tlink * Tvisual;
    vertices = transformVertices(mesh.Points, Tworld);

    patch(axRobot, ...
        'Faces', mesh.ConnectivityList, ...
        'Vertices', vertices, ...
        'FaceColor', [0.18 0.21 0.22], ...
        'EdgeColor', 'none', ...
        'FaceLighting', 'gouraud', ...
        'AmbientStrength', 0.42, ...
        'DiffuseStrength', 0.7);
    drawFrame(axRobot, Tlink(1:3, 1:3), Tlink(1:3, 4)', 0.055, visual.linkName, false);
end

camlight(axRobot, 'headlight'); material(axRobot, 'dull');
view(axRobot, 135, 22);
xlabel(axRobot, 'URDF X: forward');
ylabel(axRobot, 'URDF Y: left');
zlabel(axRobot, 'URDF Z: up');
title(axRobot, 'Correct: raw mesh basis + URDF transforms once');

%% Why the old browser model gained an extra 90-degree rotation
% TORSO.dae declares Y_UP, while Lite3.urdf already contains
% rpy = [pi/2, 0, pi/2] for its visual. The old converter first changed
% Y_UP to Z_UP, then the browser applied this URDF RPY again.

torso = visuals(strcmp({visuals.linkName}, 'TORSO'));
torsoMesh = stlread(fullfile(meshDir, torso.meshFile));
Rvisual = rpyMatrix(torso.rpy);
CyUpToZUp = [1 0 0 0; 0 0 -1 0; 0 1 0 0; 0 0 0 1];

Tcorrect = translationMatrix([-0.35 0 0]) * Rvisual;
Twrong = translationMatrix([0.35 0 0]) * Rvisual * CyUpToZUp;

axAudit = nexttile(layout, 2);
hold(axAudit, 'on'); grid(axAudit, 'on'); axis(axAudit, 'equal');
patch(axAudit, 'Faces', torsoMesh.ConnectivityList, ...
    'Vertices', transformVertices(torsoMesh.Points, Tcorrect), ...
    'FaceColor', [0.12 0.42 0.72], 'EdgeColor', 'none', 'FaceAlpha', 0.9);
patch(axAudit, 'Faces', torsoMesh.ConnectivityList, ...
    'Vertices', transformVertices(torsoMesh.Points, Twrong), ...
    'FaceColor', [0.82 0.28 0.18], 'EdgeColor', 'none', 'FaceAlpha', 0.9);
drawFrame(axAudit, Tcorrect(1:3,1:3), Tcorrect(1:3,4)', 0.12, 'Correct', true);
drawFrame(axAudit, Twrong(1:3,1:3), Twrong(1:3,4)', 0.12, 'Double 90 deg', true);
camlight(axAudit, 'headlight'); material(axAudit, 'dull');
view(axAudit, 135, 25);
xlabel(axAudit, 'X'); ylabel(axAudit, 'Y'); zlabel(axAudit, 'Z');
title(axAudit, 'Blue: correct horizontal torso; red: old vertical torso');

fprintf('\n=== Lite3 coordinate audit ===\n');
fprintf('Visual meshes: %d\n', numel(visuals));
fprintf('Browser world-basis mapping (apply once after URDF kinematics):\n');
fprintf('  Three X = URDF Y\n');
fprintf('  Three Y = URDF Z\n');
fprintf('  Three Z = URDF X\n');
fprintf('\nCorrect vertex chain:\n');
fprintf('  p_urdf = T_parent * T_joint * T_visual * p_DAE_raw\n');
fprintf('  p_three = B_urdf_to_three * p_urdf\n');
fprintf('\nThe DAE up-axis conversion must not be inserted before T_visual.\n');

%% Local helpers
function [visuals, jointByChild] = parseLite3Urdf(urdfFile)
document = xmlread(urdfFile);
visuals = struct('linkName', {}, 'meshFile', {}, 'xyz', {}, 'rpy', {});
linkNodes = document.getElementsByTagName('link');
for index = 0:linkNodes.getLength - 1
    linkNode = linkNodes.item(index);
    visualNode = directChild(linkNode, 'visual');
    if isempty(visualNode), continue; end
    geometryNode = directChild(visualNode, 'geometry');
    meshNode = directChild(geometryNode, 'mesh');
    if isempty(meshNode), continue; end
    originNode = directChild(visualNode, 'origin');
    meshPath = char(meshNode.getAttribute('filename'));
    [~, meshName] = fileparts(meshPath);
    visual.linkName = char(linkNode.getAttribute('name'));
    visual.meshFile = [meshName '.stl'];
    visual.xyz = attributeVector(originNode, 'xyz');
    visual.rpy = attributeVector(originNode, 'rpy');
    visuals(end + 1) = visual; %#ok<AGROW>
end

jointByChild = containers.Map('KeyType', 'char', 'ValueType', 'any');
jointNodes = document.getElementsByTagName('joint');
for index = 0:jointNodes.getLength - 1
    jointNode = jointNodes.item(index);
    parentNode = directChild(jointNode, 'parent');
    childNode = directChild(jointNode, 'child');
    originNode = directChild(jointNode, 'origin');
    joint.parent = char(parentNode.getAttribute('link'));
    childName = char(childNode.getAttribute('link'));
    joint.xyz = attributeVector(originNode, 'xyz');
    joint.rpy = attributeVector(originNode, 'rpy');
    jointByChild(childName) = joint;
end
end

function node = directChild(parent, name)
node = [];
if isempty(parent), return; end
children = parent.getChildNodes;
for index = 0:children.getLength - 1
    candidate = children.item(index);
    if candidate.getNodeType == candidate.ELEMENT_NODE && strcmp(char(candidate.getNodeName), name)
        node = candidate;
        return;
    end
end
end

function values = attributeVector(node, name)
values = [0 0 0];
if isempty(node) || ~node.hasAttribute(name), return; end
parsed = sscanf(char(node.getAttribute(name)), '%f')';
if numel(parsed) == 3, values = parsed; end
end

function T = linkTransform(linkName, jointByChild, cache)
if cache.isKey(linkName)
    T = cache(linkName);
    return;
end
if ~jointByChild.isKey(linkName)
    T = eye(4);
else
    joint = jointByChild(linkName);
    Tparent = linkTransform(joint.parent, jointByChild, cache);
    T = Tparent * translationMatrix(joint.xyz) * rpyMatrix(joint.rpy);
end
cache(linkName) = T;
end

function T = translationMatrix(xyz)
T = eye(4);
T(1:3,4) = xyz(:);
end

function T = rpyMatrix(rpy)
roll = rpy(1); pitch = rpy(2); yaw = rpy(3);
Rx = [1 0 0; 0 cos(roll) -sin(roll); 0 sin(roll) cos(roll)];
Ry = [cos(pitch) 0 sin(pitch); 0 1 0; -sin(pitch) 0 cos(pitch)];
Rz = [cos(yaw) -sin(yaw) 0; sin(yaw) cos(yaw) 0; 0 0 1];
T = eye(4);
T(1:3,1:3) = Rz * Ry * Rx;
end

function transformed = transformVertices(vertices, T)
homogeneous = [vertices, ones(size(vertices,1),1)] * T';
transformed = homogeneous(:,1:3);
end

function drawFrame(ax, R, origin, lengthValue, labelText, showLabel)
colors = {'r', 'g', 'b'};
for axisIndex = 1:3
    direction = R(:, axisIndex) * lengthValue;
    quiver3(ax, origin(1), origin(2), origin(3), ...
        direction(1), direction(2), direction(3), 0, ...
        'Color', colors{axisIndex}, 'LineWidth', 1.25, 'MaxHeadSize', 0.5);
end
if showLabel
    text(ax, origin(1), origin(2), origin(3) + lengthValue * 1.25, labelText, ...
        'HorizontalAlignment', 'center', 'FontSize', 9);
end
end
