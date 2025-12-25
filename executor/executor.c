#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/types.h>
#include <pwd.h>
#include <errno.h>
#include <string.h>

/**
 * usage: ./executor <rootfs_path> <uid> <command> [args...]
 * 
 * This program must be run as root or have the setuid bit set.
 */

int main(int argc, char *argv[]) {
    if (argc < 4) {
        fprintf(stderr, "Usage: %s <rootfs> <uid> <command> [args...]\n", argv[0]);
        return 1;
    }

    char *rootfs = argv[1];
    uid_t target_uid = (uid_t)atoi(argv[2]);
    char *command = argv[3];

    // 1. Perform chroot
    if (chroot(rootfs) != 0) {
        perror("chroot failed");
        return 1;
    }

    // 2. Change directory to root of the new filesystem
    if (chdir("/") != 0) {
        perror("chdir failed");
        return 1;
    }

    // 3. Drop privileges
    // using UID for simplicity here, in production ill have to switch to GID
    if (setgid(target_uid) != 0) {
        perror("setgid failed");
        return 1;
    }

    if (setuid(target_uid) != 0) {
        perror("setuid failed");
        return 1;
    }

    // 4. Execute the command
    // We pass the remaining arguments to execvp
    char **exec_args = &argv[3];
    
    if (execvp(command, exec_args) == -1) {
        perror("execvp failed");
        return 1;
    }

    return 0; // Should never reach here thats a sin
}
