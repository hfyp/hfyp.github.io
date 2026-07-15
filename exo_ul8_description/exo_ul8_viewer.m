function exo_ul8_viewer(xmlFile)
%EXO_UL8_VIEWER Display the EXO-UL8 MJCF/STL model with joint sliders.
%
%   exo_ul8_viewer
%   exo_ul8_viewer("/path/to/exoul8.xml")
%
% The function reads the MuJoCo XML directly; Robotics System Toolbox is
% not required.  The XML and all STL files should stay in the same folder.
% Joint slider values are shown in degrees, while the MJCF limits remain in
% radians internally.

if nargin < 1 || strlength(string(xmlFile)) == 0
    xmlFile = fullfile(fileparts(mfilename('fullpath')), 'exoul8.xml');
end
xmlFile = char(xmlFile);
assert(isfile(xmlFile), 'EXO_UL8:MissingXML', 'XML file not found: %s', xmlFile);

model = readMjcf(xmlFile);
model.q = zeros(numel(model.joints), 1);
sliderHandles = gobjects(numel(model.joints), 1);

fig = uifigure('Name', 'EXO-UL8 MATLAB Joint Viewer', ...
    'Color', [0.96 0.96 0.96], 'Position', [80 80 1280 780]);
mainGrid = uigridlayout(fig, [1 2]);
mainGrid.ColumnWidth = {'3x', 390};
mainGrid.Padding = [8 8 8 8];
mainGrid.ColumnSpacing = 8;

ax = uiaxes(mainGrid);
ax.Color = 'none';
ax.XColor = [0.28 0.30 0.34];
ax.YColor = [0.28 0.30 0.34];
ax.ZColor = [0.28 0.30 0.34];
grid(ax, 'off');
axis(ax, 'equal');
view(ax, 115, 18);
camproj(ax, 'orthographic');
xlabel(ax, 'X (m)'); ylabel(ax, 'Y (m)'); zlabel(ax, 'Z (m)');
title(ax, 'EXO-UL8 bilateral model', 'Color', [0.16 0.18 0.22]);
hold(ax, 'on');
camlight(ax, 'headlight');
lighting(ax, 'gouraud');

colors = [0.12 0.43 0.82; 0.90 0.42 0.14];
modelMin = [inf inf inf];
modelMax = [-inf -inf -inf];
for k = 1:numel(model.parts)
    [faces, vertices] = readStlMesh(model.parts(k).file);
    vertices = vertices .* model.parts(k).meshScale;
    zeroPoseVertices = vertices + model.parts(k).geomPos;
    modelMin = min(modelMin, min(zeroPoseVertices, [], 1));
    modelMax = max(modelMax, max(zeroPoseVertices, [], 1));
    t = hgtransform('Parent', ax);
    side = 1 + contains(lower(model.parts(k).name), 'left');
    patch('Faces', faces, 'Vertices', vertices, 'Parent', t, ...
        'FaceColor', colors(side, :), 'EdgeColor', 'none', ...
        'FaceLighting', 'gouraud', 'AmbientStrength', 0.30, ...
        'DiffuseStrength', 0.72, 'SpecularStrength', 0.25);
    model.parts(k).transform = t;
end
modelCenter = (modelMin + modelMax) / 2;
modelSpan = max(modelMax - modelMin);

rightGrid = uigridlayout(mainGrid, [2 1]);
rightGrid.RowHeight = {86, '1x'};
rightGrid.Padding = [0 0 0 0];
rightGrid.RowSpacing = 6;

viewPanel = uipanel(rightGrid, 'Title', 'View');
viewGrid = uigridlayout(viewPanel, [2 4]);
viewGrid.ColumnWidth = {72, '1x', 72, 120};
viewGrid.RowHeight = {22, 30};
viewGrid.Padding = [8 3 8 5];
scaleTitle = uilabel(viewGrid, 'Text', 'Scale');
scaleTitle.Layout.Row = 1;
scaleTitle.Layout.Column = 1;
scaleValue = uilabel(viewGrid, 'Text', '1.00x', 'HorizontalAlignment', 'center');
scaleValue.Layout.Row = 1;
scaleValue.Layout.Column = 2;
fitButton = uibutton(viewGrid, 'Text', 'Fit', ...
    'ButtonPushedFcn', @(~, ~) resetViewScale());
fitButton.Layout.Row = 1;
fitButton.Layout.Column = 3;
saveButton = uibutton(viewGrid, 'Text', 'Save transparent PNG', ...
    'ButtonPushedFcn', @(~, ~) saveTransparentPng());
saveButton.Layout.Row = 1;
saveButton.Layout.Column = 4;
scaleSlider = uislider(viewGrid, 'Limits', [0.4 2.0], 'Value', 1, ...
    'MajorTicks', [0.4 0.75 1 1.5 2]);
scaleSlider.Layout.Row = 2;
scaleSlider.Layout.Column = [1 4];
scaleSlider.ValueChangingFcn = @(~, event) setViewScale(event.Value);
scaleSlider.ValueChangedFcn = @(~, event) setViewScale(event.Value);

tabs = uitabgroup(rightGrid);
rightTab = uitab(tabs, 'Title', 'Right arm');
leftTab = uitab(tabs, 'Title', 'Left arm');
addJointControls(rightTab, false);
addJointControls(leftTab, true);

updateModel();
fitView(1);

    function addJointControls(parent, isLeft)
        indices = find(contains({model.joints.name}, 'Left') == isLeft);
        panelGrid = uigridlayout(parent, [numel(indices) + 2, 2]);
        panelGrid.ColumnWidth = {100, '1x'};
        panelGrid.RowHeight = [repmat({68}, 1, numel(indices)), {34, '1x'}];
        panelGrid.Padding = [12 12 12 12];

        for row = 1:numel(indices)
            index = indices(row);
            limitsDeg = rad2deg(model.joints(index).range);
            initialDeg = min(max(0, limitsDeg(1)), limitsDeg(2));
            model.q(index) = deg2rad(initialDeg);

            label = uilabel(panelGrid, 'Text', model.joints(index).name, ...
                'FontWeight', 'bold');
            label.Layout.Row = row;
            label.Layout.Column = 1;

            slider = uislider(panelGrid, 'Limits', limitsDeg, ...
                'Value', initialDeg, 'MajorTicks', sliderTicks(limitsDeg));
            slider.Layout.Row = row;
            slider.Layout.Column = 2;
            slider.ValueChangingFcn = @(~, event) setJoint(index, event.Value);
            slider.ValueChangedFcn = @(~, event) setJoint(index, event.Value);
            sliderHandles(index) = slider;
        end

        resetButton = uibutton(panelGrid, 'Text', 'Reset this arm', ...
            'ButtonPushedFcn', @(~, ~) resetArm(indices));
        resetButton.Layout.Row = numel(indices) + 1;
        resetButton.Layout.Column = [1 2];
    end

    function setJoint(index, valueDeg)
        model.q(index) = deg2rad(valueDeg);
        updateModel();
    end

    function resetArm(indices)
        for index = indices(:)'
            model.q(index) = min(max(0, model.joints(index).range(1)), ...
                model.joints(index).range(2));
            sliderHandles(index).Value = rad2deg(model.q(index));
        end
        updateModel();
    end

    function updateModel()
        for partIndex = 1:numel(model.parts)
            matrix = eye(4);
            chain = model.parts(partIndex).jointChain;
            for chainIndex = chain
                joint = model.joints(chainIndex);
                matrix = matrix * rotateAbout(joint.axis, joint.pos, model.q(chainIndex));
            end
            matrix = matrix * translationMatrix(model.parts(partIndex).geomPos);
            model.parts(partIndex).transform.Matrix = matrix;
        end
        drawnow limitrate;
    end

    function setViewScale(value)
        scaleValue.Text = sprintf('%.2fx', value);
        fitView(value);
    end

    function resetViewScale()
        scaleSlider.Value = 1;
        setViewScale(1);
    end

    function fitView(viewScale)
        % Direct STL bounds avoid axis-tight errors with hgtransform objects.
        span = max(modelSpan, 0.1) * 1.18 / viewScale;
        ax.XLim = modelCenter(1) + [-span span] / 2;
        ax.YLim = modelCenter(2) + [-span span] / 2;
        ax.ZLim = modelCenter(3) + [-span span] / 2;
        drawnow limitrate;
    end

    function saveTransparentPng()
        [file, path] = uiputfile('*.png', 'Save transparent EXO-UL8 image', ...
            'exo_ul8_transparent.png');
        if isequal(file, 0)
            return
        end
        exportgraphics(ax, fullfile(path, file), 'BackgroundColor', 'none', ...
            'ContentType', 'image', 'Resolution', 300);
    end
end

function model = readMjcf(xmlFile)
doc = xmlread(xmlFile);
xmlDir = fileparts(xmlFile);

meshNodes = doc.getElementsByTagName('mesh');
meshFiles = containers.Map('KeyType', 'char', 'ValueType', 'char');
meshScales = containers.Map('KeyType', 'char', 'ValueType', 'any');
for k = 0:meshNodes.getLength - 1
    node = meshNodes.item(k);
    if node.hasAttribute('name') && node.hasAttribute('file')
        name = char(node.getAttribute('name'));
        meshFiles(name) = fullfile(xmlDir, char(node.getAttribute('file')));
        meshScales(name) = vectorAttribute(node, 'scale', [1 1 1]);
    end
end

model.joints = struct('name', {}, 'pos', {}, 'axis', {}, 'range', {});
model.parts = struct('name', {}, 'file', {}, 'meshScale', {}, ...
    'geomPos', {}, 'jointChain', {}, 'transform', {});
worldNodes = doc.getElementsByTagName('worldbody');
assert(worldNodes.getLength > 0, 'EXO_UL8:InvalidXML', ...
    'No <worldbody> element was found in %s.', xmlFile);
walkChildren(worldNodes.item(0), []);

    function walkChildren(parentNode, inheritedChain)
        children = parentNode.getChildNodes;
        for childIndex = 0:children.getLength - 1
            bodyNode = children.item(childIndex);
            if bodyNode.getNodeType ~= 1 || ...
                    ~strcmp(char(bodyNode.getNodeName), 'body')
                continue
            end

            bodyName = char(bodyNode.getAttribute('name'));
            chain = inheritedChain;
            bodyChildren = bodyNode.getChildNodes;
            for elementIndex = 0:bodyChildren.getLength - 1
                element = bodyChildren.item(elementIndex);
                if element.getNodeType ~= 1
                    continue
                end
                elementName = char(element.getNodeName);
                if strcmp(elementName, 'joint')
                    joint.name = char(element.getAttribute('name'));
                    joint.pos = vectorAttribute(element, 'pos', [0 0 0]);
                    joint.axis = vectorAttribute(element, 'axis', [0 0 1]);
                    joint.axis = joint.axis / norm(joint.axis);
                    joint.range = vectorAttribute(element, 'range', [-pi pi]);
                    model.joints(end + 1) = joint; %#ok<AGROW>
                    chain(end + 1) = numel(model.joints); %#ok<AGROW>
                elseif strcmp(elementName, 'geom') && element.hasAttribute('mesh')
                    meshName = char(element.getAttribute('mesh'));
                    assert(isKey(meshFiles, meshName), 'EXO_UL8:MissingAsset', ...
                        'Mesh asset "%s" is not declared.', meshName);
                    meshPath = meshFiles(meshName);
                    assert(isfile(meshPath), 'EXO_UL8:MissingSTL', ...
                        'STL file not found: %s', meshPath);
                    part.name = bodyName;
                    part.file = meshPath;
                    part.meshScale = meshScales(meshName);
                    part.geomPos = vectorAttribute(element, 'pos', [0 0 0]);
                    part.jointChain = chain;
                    part.transform = [];
                    model.parts(end + 1) = part; %#ok<AGROW>
                end
            end
            walkChildren(bodyNode, chain);
        end
    end
end

function value = vectorAttribute(node, attribute, defaultValue)
if ~node.hasAttribute(attribute)
    value = defaultValue;
    return
end
value = sscanf(char(node.getAttribute(attribute)), '%f').';
if numel(value) ~= numel(defaultValue) || any(~isfinite(value))
    value = defaultValue;
end
end

function [faces, vertices] = readStlMesh(filename)
try
    mesh = stlread(filename);
    if isa(mesh, 'triangulation')
        faces = mesh.ConnectivityList;
        vertices = mesh.Points;
    elseif isstruct(mesh) && isfield(mesh, 'Faces') && isfield(mesh, 'Vertices')
        faces = mesh.Faces;
        vertices = mesh.Vertices;
    else
        [faces, vertices] = stlread(filename);
    end
catch error
    error('EXO_UL8:STLReadFailed', 'Could not read %s\n%s', filename, error.message);
end
vertices = double(vertices);
faces = double(faces);
end

function matrix = rotateAbout(axisVector, pivot, angle)
axisVector = axisVector(:) / norm(axisVector);
pivot = pivot(:);
x = axisVector(1); y = axisVector(2); z = axisVector(3);
c = cos(angle); s = sin(angle); oneMinusC = 1 - c;
rotation = [ ...
    c + x*x*oneMinusC,     x*y*oneMinusC - z*s, x*z*oneMinusC + y*s; ...
    y*x*oneMinusC + z*s,   c + y*y*oneMinusC,   y*z*oneMinusC - x*s; ...
    z*x*oneMinusC - y*s,   z*y*oneMinusC + x*s, c + z*z*oneMinusC];
matrix = [rotation, pivot - rotation * pivot; 0 0 0 1];
end

function matrix = translationMatrix(offset)
matrix = eye(4);
matrix(1:3, 4) = offset(:);
end

function ticks = sliderTicks(limits)
ticks = unique(round([limits(1), min(max(0, limits(1)), limits(2)), limits(2)], 1));
end
