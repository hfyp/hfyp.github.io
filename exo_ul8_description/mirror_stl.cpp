
#include <iostream>
#include <filesystem>
#include <fstream>

int main(int argc, char *argv[]){
    if(argc != 3){
        std::cout << "Incorrect number of arguments. Usage: mirror_stl <in-file> <out-file>";
        return -1;
    }

    // Read the file into memory
    std::filesystem::path file{argv[1]};
    const size_t file_size = std::filesystem::file_size(file);
    char* buffer = new char[file_size];
    std::ifstream input_stream(file, std::ios::in | std::ios::binary);
    input_stream.read(buffer, file_size);
    std::cout << "Read " << argv[1] << " (" << file_size << " bytes).\n";

    static_assert(sizeof(float) == 4, "sizeof(float) must be 4 to use this program.");

    // Loop through the vertices and flip about the x-axis
    // STL format from (https://www.fabbers.com/tech/STL_Format)
    for(size_t i = 84; i < file_size; i += 50){
        // Flip the x-axis of the normal vector
        *(float*)(buffer + i) *= -1.0;
        
        // Flip the x-axes of the three vertices
        *(float*)(buffer + i + 12) *= -1.0;
        *(float*)(buffer + i + 24) *= -1.0;
        *(float*)(buffer + i + 36) *= -1.0;

        // In order to preserve the right-hand rule, swap the order of the vertices
        std::swap(*(float*)(buffer + i + 12), *(float*)(buffer + i + 36));
        std::swap(*(float*)(buffer + i + 16), *(float*)(buffer + i + 40));
        std::swap(*(float*)(buffer + i + 20), *(float*)(buffer + i + 44));
    }

    // Output the buffer to a new file
    std::ofstream output_stream(argv[2], std::ios::out | std::ios::binary);
    output_stream.write(buffer, file_size);
    std::cout << "Wrote " << argv[2] << " (" << file_size << " bytes).\n";

    return 0;
}