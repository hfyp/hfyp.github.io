function convert_exo_meshes()
%CONVERT_EXO_MESHES Build the medium-high fidelity EXO-UL8 web meshes.
% The browser loads one right arm and mirrors it, so these target counts are
% paid once in network/GPU memory while both displayed arms share geometry.

scriptDir = fileparts(mfilename('fullpath'));
repoRoot = fileparts(scriptDir);
sourceDir = fullfile(repoRoot, 'exo_ul8_description');
destinationDir = fullfile(repoRoot, 'museum', 'models', 'exo-ul8');
if ~isfolder(destinationDir), mkdir(destinationDir); end

% About 150k faces total: 3.85x the old 39k web mesh, but only 34% of the
% 443k-face manufacturing/display source. Curved motors and distal housings
% receive proportionally more faces because faceting is most visible there.
targetFaces = [12000, 29000, 15000, 24500, 14500, 20000, 14000, 22000];

fprintf('\n=== EXO-UL8 web mesh conversion ===\n');
totalOriginal = 0;
totalReduced = 0;
totalBytes = 0;
for linkIndex = 0:7
    source = fullfile(sourceDir, sprintf('link%d.stl', linkIndex));
    destination = fullfile(destinationDir, sprintf('link%d.stl', linkIndex));
    assert(isfile(source), 'Missing EXO source mesh: %s', source);

    inputMesh = stlread(source);
    originalFaces = size(inputMesh.ConnectivityList, 1);
    requestedFaces = min(targetFaces(linkIndex + 1), originalFaces);
    [faces, vertices] = reducepatch( ...
        inputMesh.ConnectivityList, inputMesh.Points, requestedFaces, 'fast');
    outputMesh = triangulation(faces, vertices);
    stlwrite(outputMesh, destination, 'binary');

    writtenFaces = size(faces, 1);
    fileInfo = dir(destination);
    totalOriginal = totalOriginal + originalFaces;
    totalReduced = totalReduced + writtenFaces;
    totalBytes = totalBytes + fileInfo.bytes;
    fprintf('link%d  %7d -> %7d faces  %6.2f MiB\n', ...
        linkIndex, originalFaces, writtenFaces, fileInfo.bytes / 1024 / 1024);
end
fprintf('TOTAL  %7d -> %7d faces  %6.2f MiB\n', ...
    totalOriginal, totalReduced, totalBytes / 1024 / 1024);
end
